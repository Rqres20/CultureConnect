// City search: geocode with Nominatim, fetch Wikipedia summary, and find nearby POIs via Overpass
(function(){
    const input = document.getElementById('city-input');
    const btn = document.getElementById('city-search-btn');
    const results = document.getElementById('city-results');
    // Create suggestions box
    const suggestionsBox = document.createElement('div');
    suggestionsBox.className = 'suggestions-box';
    input.parentNode.insertBefore(suggestionsBox, input.nextSibling);
    let suggestions = [];
    let activeIndex = -1;

    function setLoading(on) {
        if (on) {
            btn.disabled = true;
            btn.textContent = 'Searching...';
        } else {
            btn.disabled = false;
            btn.textContent = 'Search';
        }
    }

    function clearResults() {
        results.innerHTML = '';
        try { window.CCPoiLayer.clearLayers(); } catch (e) {}
    }

    async function geocodeCity(q) {
        const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q);
        const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
        const data = await res.json();
        if (!data || !data.length) throw new Error('City not found');
        return data[0]; // contains lat, lon, display_name
    }

    // Fetch suggestions from Nominatim (limit 6)
    async function fetchSuggestions(q) {
        if (!q) return [];
        const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=6&q=' + encodeURIComponent(q);
        const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
        const data = await res.json();
        return data || [];
    }

    function renderSuggestions(list) {
        suggestions = list;
        activeIndex = -1;
        suggestionsBox.innerHTML = '';
        if (!list || !list.length) { suggestionsBox.style.display = 'none'; return; }
        for (let i=0;i<list.length;i++) {
            const item = list[i];
            const el = document.createElement('div');
            el.className = 'suggestion-item';
            el.textContent = item.display_name;
            el.dataset.index = i;
            el.addEventListener('click', () => selectSuggestion(i));
            suggestionsBox.appendChild(el);
        }
        suggestionsBox.style.display = 'block';
    }

    function selectSuggestion(i) {
        const sel = suggestions[i];
        if (!sel) return;
        input.value = sel.display_name.split(',')[0];
        suggestionsBox.style.display = 'none';
        // trigger search using selected suggestion coordinates
        (async ()=>{
            clearResults(); setLoading(true);
            try {
                const city = sel; // use the suggestion directly
                const lat = parseFloat(city.lat); const lon = parseFloat(city.lon);
                try { window.CCMap.setView([lat, lon], 12); } catch (e) {}
                const [wiki, pois] = await Promise.allSettled([
                    fetchWikiSummary(city.display_name.split(',')[0]),
                    fetchPOIs(lat, lon, 7000)
                ]);
                const wikiRes = wiki.status === 'fulfilled' ? wiki.value : null;
                const poisRes = pois.status === 'fulfilled' ? pois.value : [];
                const poiItems = createPoiList(poisRes, { lat, lon });
                renderResults(city, wikiRes, poiItems);
                addPoiMarkers(poiItems, { lat, lon, display_name: city.display_name.split(',')[0] });
            } catch (err) {
                results.innerHTML = `<p style="color:#b00">${escapeHtml(err.message || 'Search failed')}</p>`;
            } finally { setLoading(false); }
        })();
    }

    // Debounce helper
    function debounce(fn, wait) {
        let t;
        return function(...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    async function fetchWikiSummary(title) {
        // Use opensearch to get the exact article title then fetch summary
        const sUrl = 'https://en.wikipedia.org/w/api.php?action=opensearch&limit=1&format=json&origin=*&search=' + encodeURIComponent(title);
        const sRes = await fetch(sUrl);
        const sJson = await sRes.json();
        const match = sJson && sJson[1] && sJson[1][0];
        if (!match) return null;
        const api = 'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(match);
        const r = await fetch(api);
        if (!r.ok) return null;
        return await r.json();
    }

    async function fetchPOIs(lat, lon, radius = 5000) {
        // Query Overpass for common cultural POI tags around the city center
        const query = `
        [out:json][timeout:25];
        (
          node(around:${radius},${lat},${lon})[tourism];
          way(around:${radius},${lat},${lon})[tourism];
          node(around:${radius},${lat},${lon})[historic];
          way(around:${radius},${lat},${lon})[historic];
          node(around:${radius},${lat},${lon})[amenity~"museum|theatre|arts_centre|cinema"];
          way(around:${radius},${lat},${lon})[amenity~"museum|theatre|arts_centre|cinema"];
          node(around:${radius},${lat},${lon})[leisure=park];
          way(around:${radius},${lat},${lon})[leisure=park];
        );
        out center 50;
        `;
        const url = 'https://overpass-api.de/api/interpreter';
        const res = await fetch(url, { method: 'POST', body: query, headers: { 'Content-Type': 'text/plain' } });
        const json = await res.json();
        return json.elements || [];
    }

    // Fallback: use Wikipedia geosearch to find nearby pages (attractions)
    async function fetchWikiNearby(lat, lon, radius = 10000) {
        try {
            const url = `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}|${lon}&gsradius=${radius}&gslimit=10&format=json&origin=*`;
            const res = await fetch(url);
            const json = await res.json();
            const pages = (json && json.query && json.query.geosearch) || [];
            if (!pages.length) return null;
            // pick the first page and fetch its summary
            const page = pages[0];
            const title = page.title;
            const sum = await fetchWikiSummary(title);
            return { page, summary: sum };
        } catch (e) { return null; }
    }

    function createPoiList(elements, center) {
        // Map elements to items with name, type, lat/lon
        const items = elements
            .map(el => {
                const name = el.tags && (el.tags.name || el.tags.official_name);
                const type = el.tags && (el.tags.tourism || el.tags.historic || el.tags.amenity || el.tags.leisure || 'place');
                const lat = el.lat || (el.center && el.center.lat);
                const lon = el.lon || (el.center && el.center.lon);
                if (!name || !lat || !lon) return null;
                const d = distanceMeters(center.lat, center.lon, lat, lon);
                return { name, type, lat, lon, dist: d };
            })
            .filter(Boolean)
            .sort((a,b) => a.dist - b.dist)
            .slice(0,12);
        // If no named items were found but elements exist, try to derive names from tags
        if (!items.length && elements && elements.length) {
            const derived = [];
            for (const el of elements) {
                const lat = el.lat || (el.center && el.center.lat);
                const lon = el.lon || (el.center && el.center.lon);
                if (!lat || !lon) continue;
                const tags = el.tags || {};
                // try several tag keys to create a readable name
                const nameCandidates = [tags.name, tags['int_name'], tags['official_name'], tags.wikidata, tags.tourism, tags.historic, tags.amenity, tags.leisure];
                let name = nameCandidates.find(x => x && x.length);
                if (!name) {
                    // build a fallback name from type tags
                    const type = tags.tourism || tags.historic || tags.amenity || tags.leisure || 'place';
                    name = type.charAt(0).toUpperCase() + type.slice(1);
                }
                const d = distanceMeters(center.lat, center.lon, lat, lon);
                derived.push({ name, type: tags.tourism || tags.historic || tags.amenity || tags.leisure || 'place', lat, lon, dist: d });
            }
            return derived.sort((a,b) => a.dist - b.dist).slice(0,6);
        }

        return items;
    }

    function distanceMeters(lat1, lon1, lat2, lon2) {
        const R = 6371e3; // metres
        const toRad = v => v * Math.PI/180;
        const φ1 = toRad(lat1); const φ2 = toRad(lat2);
        const Δφ = toRad(lat2-lat1); const Δλ = toRad(lon2-lon1);
        const a = Math.sin(Δφ/2)*Math.sin(Δφ/2) + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)*Math.sin(Δλ/2);
        const c = 2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R*c;
    }

    function renderResults(city, wiki, poiItems) {
        // Update global current city for rewards system
        try {
            window.CCCurrentCity = {
                name: city.display_name.split(',')[0],
                lat: parseFloat(city.lat),
                lon: parseFloat(city.lon)
            };
        } catch (e) {}

        const parts = [];
        parts.push(`<h3 style="margin:6px 0 6px;">${city.display_name.split(',')[0]}</h3>`);
        if (wiki && wiki.extract) {
            parts.push(`<p>${wiki.extract_html ? wiki.extract_html : escapeHtml(wiki.extract)}</p>`);
        }
        if (poiItems.length) {
            parts.push('<h4 style="margin:10px 0 6px;">Top places & activities</h4>');
            parts.push('<ul class="poi-list">');
            for (const it of poiItems) {
                parts.push(`<li><strong>${escapeHtml(it.name)}</strong> — ${escapeHtml(it.type)} <span class="muted">(${Math.round(it.dist)} m)</span></li>`);
            }
            parts.push('</ul>');
        } else {
            parts.push('<p><em>No major attractions found nearby.</em></p>');
        }
        results.innerHTML = parts.join('');
    }

    function escapeHtml(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }

    function addPoiMarkers(items, center) {
        try { window.CCPoiLayer.clearLayers(); } catch (e) {}
        for (const it of items) {
            try {
                const m = L.marker([it.lat, it.lon]).bindPopup(`<strong>${escapeHtml(it.name)}</strong><br>${escapeHtml(it.type)}`);
                window.CCPoiLayer.addLayer(m);
            } catch (e) {}
        }
        // also add a marker for the city center
        try {
            const cityMarker = L.circleMarker([center.lat, center.lon], { radius:6, color:'#ff6b6b', fillColor:'#fff', fillOpacity:1 }).bindPopup(`<strong>${escapeHtml(center.display_name || 'City')}</strong>`);
            window.CCPoiLayer.addLayer(cityMarker);
        } catch (e) {}
    }

    async function onSearch() {
        const q = (input.value || '').trim();
        if (!q) return;
        clearResults(); setLoading(true);
        try {
            const city = await geocodeCity(q);
            const lat = parseFloat(city.lat); const lon = parseFloat(city.lon);
            // center map and zoom
            try { window.CCMap.setView([lat, lon], 12); } catch (e) {}

            // fetch wiki and POIs in parallel
            const [wiki, pois] = await Promise.allSettled([
                fetchWikiSummary(city.display_name.split(',')[0]),
                fetchPOIs(lat, lon, 8000)
            ]);

            const wikiRes = wiki.status === 'fulfilled' ? wiki.value : null;
            const poisRes = pois.status === 'fulfilled' ? pois.value : [];
            let poiItems = createPoiList(poisRes, { lat, lon });

            // If Overpass returned no POIs, use Wikipedia geosearch as a fallback to ensure at least one attraction
            let wikiNearby = null;
            if (!poiItems.length) {
                wikiNearby = await fetchWikiNearby(lat, lon, 10000);
                if (wikiNearby && wikiNearby.page) {
                    const p = wikiNearby.page;
                    const item = {
                        name: p.title,
                        type: 'landmark',
                        lat: p.lat,
                        lon: p.lon,
                        dist: distanceMeters(lat, lon, p.lat, p.lon)
                    };
                    poiItems = [item];
                }
            }

            renderResults(city, wikiRes || (wikiNearby && wikiNearby.summary), poiItems);
            addPoiMarkers(poiItems, { lat, lon, display_name: city.display_name.split(',')[0] });
        } catch (err) {
            results.innerHTML = `<p style="color:#b00">${escapeHtml(err.message || 'Search failed')}</p>`;
        } finally {
            setLoading(false);
        }
    }

    btn.addEventListener('click', onSearch);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') onSearch(); });

    // Autocomplete on input with debounce
    const handleInput = debounce(async function() {
        const q = (input.value || '').trim();
        if (!q) { renderSuggestions([]); return; }
        try {
            const list = await fetchSuggestions(q);
            renderSuggestions(list.filter(i=> i.type === 'city' || i.class === 'place' || true));
        } catch (e) { renderSuggestions([]); }
    }, 300);

    input.addEventListener('input', handleInput);

    // keyboard navigation for suggestions
    input.addEventListener('keydown', (e) => {
        if (suggestionsBox.style.display !== 'block') return;
        const items = suggestionsBox.querySelectorAll('.suggestion-item');
        if (!items.length) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault(); activeIndex = Math.min(activeIndex+1, items.length-1);
            updateActive(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault(); activeIndex = Math.max(activeIndex-1, 0);
            updateActive(items);
        } else if (e.key === 'Enter') {
            if (activeIndex >=0) { e.preventDefault(); selectSuggestion(activeIndex); }
        } else if (e.key === 'Escape') { suggestionsBox.style.display = 'none'; }
    });

    function updateActive(items) {
        items.forEach((it, idx) => it.classList.toggle('active', idx === activeIndex));
        if (activeIndex >=0) items[activeIndex].scrollIntoView({ block: 'nearest' });
    }

})();
