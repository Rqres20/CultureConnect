// Initialize Leaflet map and load world countries GeoJSON
(function(){
    // Create map: allow panning and zooming, but prevent horizontal wrapping
        const mapDiv = document.getElementById('map');
        function resizeMapContainer() {
            const nav = document.querySelector('.navbar');
            const navH = nav ? Math.ceil(nav.getBoundingClientRect().height) : 0;
            // leave no extra margin so the map fills the container exactly
            const margin = 0;
            mapDiv.style.height = (window.innerHeight - navH - margin) + 'px';
        }
        // Run once and on resize
        resizeMapContainer();
        window.addEventListener('resize', resizeMapContainer);

        // Create map after sizing container (start more zoomed-in)
        const map = L.map('map', {
            center: [20, 0],
            zoom: 4,
            worldCopyJump: false,
            dragging: true,
            touchZoom: true,
            doubleClickZoom: true,
            scrollWheelZoom: true,
            boxZoom: true,
            keyboard: false,
            maxBoundsViscosity: 0.8
        });

    // Expose map and a POI layer for other scripts
    try { window.CCMap = map; } catch (e) {}
    try { window.CCPoiLayer = L.layerGroup().addTo(map); } catch (e) {}
    
    // Track current city location for rewards
    try { window.CCCurrentCity = { name: '', lat: null, lon: null }; } catch (e) {}

    // constrain map to world bounds to avoid repeat wrap; allows panning within bounds
    map.setMaxBounds([[-90, -180], [90, 180]]);

    // Add Esri World Imagery (satellite) tiles — no labels and high detail
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
        noWrap: true
    }).addTo(map);

    // ensure Leaflet recalculates size after initial render
    setTimeout(() => { try { map.invalidateSize(); } catch (e) {} }, 250);
    // on window resize, resize container and tell Leaflet to recalc
    window.addEventListener('resize', () => { resizeMapContainer(); try { map.invalidateSize(); } catch (e) {} });

    // Style and interaction handlers
    function style(feature) {
        return {
            weight: 0.7,
            color: '#2c3e50',
            fillColor: '#8B5FFF',
            fillOpacity: 0.15
        };
    }

    function highlight(e) {
        const layer = e.target;
        layer.setStyle({ weight: 1.6, fillOpacity: 0.28 });
        if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
            layer.bringToFront();
        }
    }

    function resetHighlight(e) {
        geojson && geojson.resetStyle(e.target);
    }

    function getEnglishName(props) {
        if (!props) return null;
        // common property names that may contain English names
        const keys = ['name', 'NAME_EN', 'name_en', 'ADMIN', 'NAME', 'sovereignt', 'formal_en', 'en_name', 'ENGLISH'];
        for (const k of keys) {
            if (props[k]) return props[k];
            // try lowercase variant
            if (props[k.toLowerCase()]) return props[k.toLowerCase()];
        }
        return null;
    }

    function onEachFeature(feature, layer) {
        layer.on({
            mouseover: highlight,
            mouseout: resetHighlight,
            click: function(e) {
                const name = getEnglishName(feature.properties) || feature.properties.ADMIN || 'Unknown';
                // Open a popup immediately with loading state, then fetch richer info
                const popup = L.popup({ maxWidth: 520, autoClose: true })
                    .setLatLng(e.latlng)
                    .setContent('<div class="country-popup">Loading information for <strong>' + escapeHtml(name) + '</strong>...</div>')
                    .openOn(map);

                // Fetch and display country details asynchronously
                (async function showCountryDetails() {
                    try {
                        const detailsHtml = await buildCountryDetailsHtml(name, feature.properties);
                        popup.setContent(detailsHtml);
                        popup.update();
                    } catch (err) {
                        console.error('Country details error:', err);
                        popup.setContent('<div class="country-popup">Could not load country details for <strong>' + escapeHtml(name) + '</strong>.</div>');
                    }
                })();
            }
        });
    }

    // Helper: escape HTML
    function escapeHtml(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }

    // Fetch country data from Rest Countries API (with fallback)
    async function fetchRestCountry(name) {
        const tryUrl = async (url) => {
            const res = await fetch(url);
            if (!res.ok) return null;
            const json = await res.json();
            return json && json.length ? json[0] : null;
        };
        // try fullText search first
        let data = await tryUrl('https://restcountries.com/v3.1/name/' + encodeURIComponent(name) + '?fullText=true');
        if (!data) data = await tryUrl('https://restcountries.com/v3.1/name/' + encodeURIComponent(name));
        return data;
    }

    // Fetch Wikipedia summary for a title
    async function fetchWikiSummaryTitle(title) {
        try {
            const url = 'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title);
            const res = await fetch(url);
            if (!res.ok) return null;
            return await res.json();
        } catch (e) { return null; }
    }

    // Build HTML for country details: name, capital, two short facts, capital image
    async function buildCountryDetailsHtml(countryName, props) {
        // Attempt to get Rest Countries record
        const rest = await fetchRestCountry(countryName);
        let capital = rest && rest.capital && rest.capital[0] ? rest.capital[0] : (props && (props.CAPITAL || props.capital) ? (props.CAPITAL || props.capital) : '');
        // Get country wiki summary
        const wikiCountry = await fetchWikiSummaryTitle(countryName);
        // Derive surprising facts: take sentences from wiki extract beyond the first (if available)
        let factsHtml = '';
        if (wikiCountry && wikiCountry.extract) {
            const sentences = wikiCountry.extract.split(/\.\s+/).filter(Boolean);
            const facts = [];
            // Prefer sentences that are not the first short description
            for (let i = 1; i < Math.min(sentences.length, 6) && facts.length < 2; i++) {
                const s = sentences[i].trim();
                if (s && s.length > 20) facts.push(s + (s.endsWith('.') ? '' : '.'));
            }
            // fallback to first sentences if none found
            if (!facts.length && sentences.length) {
                facts.push(sentences[0]);
                if (sentences.length > 1) facts.push(sentences[1]);
            }
            if (facts.length) factsHtml = '<ul class="country-facts">' + facts.map(f => '<li>' + escapeHtml(f) + '</li>').join('') + '</ul>';
        }

        // Get capital image via Wikipedia summary for the capital
        let capitalImgHtml = '';
        if (capital) {
            const wikiCapital = await fetchWikiSummaryTitle(capital);
            if (wikiCapital && wikiCapital.thumbnail && wikiCapital.thumbnail.source) {
                capitalImgHtml = '<div class="country-capital-image"><img src="' + escapeHtml(wikiCapital.thumbnail.source) + '" alt="' + escapeHtml(capital) + '" /></div>';
            }
        }

        // Build the final HTML block
        const countryHeader = '<h3 style="margin:0 0 8px;">' + escapeHtml(countryName) + '</h3>';
        const capitalLine = capital ? '<p><strong>Capital:</strong> ' + escapeHtml(capital) + '</p>' : '';
        const wikiIntro = (wikiCountry && wikiCountry.extract) ? ('<p>' + escapeHtml(wikiCountry.extract.split('. ').slice(0,1).join('. ') ) + '.</p>') : '';

        const html = '<div class="country-popup">' + countryHeader + capitalLine + capitalImgHtml + wikiIntro + (factsHtml || '<p><em>No short facts available.</em></p>') + '</div>';
        return html;
    }

    // Fetch GeoJSON of world countries (CORS-enabled raw GitHub)
    const geoUrl = 'https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json';
    let geojson = null;
        // LayerGroup for country name labels (markers with divIcons)
        const labelsLayer = L.layerGroup();
        const LABEL_MIN_ZOOM = 4; // minimum zoom to show labels

    fetch(geoUrl).then(res => {
        if (!res.ok) throw new Error('Failed to load countries GeoJSON');
        return res.json();
    }).then(data => {
        geojson = L.geoJSON(data, { style, onEachFeature }).addTo(map);
        // Create label markers for each country using layer bounds center
        data.features.forEach((feature, idx) => {
            // try to find corresponding layer to compute bounds center
            const layer = geojson.getLayers()[idx];
            if (!layer) return;
            const center = layer.getBounds ? layer.getBounds().getCenter() : null;
            const name = getEnglishName(feature.properties) || '';
            if (center && name) {
                const marker = L.marker(center, {
                    interactive: false,
                    icon: L.divIcon({ className: 'country-label', html: name })
                });
                labelsLayer.addLayer(marker);
            }
        });
        // Add labels only if current zoom >= LABEL_MIN_ZOOM
        if (map.getZoom() >= LABEL_MIN_ZOOM) labelsLayer.addTo(map);

        // Update labels on zoom
        map.on('zoomend', () => {
            if (map.getZoom() >= LABEL_MIN_ZOOM) {
                if (!map.hasLayer(labelsLayer)) map.addLayer(labelsLayer);
            } else {
                if (map.hasLayer(labelsLayer)) map.removeLayer(labelsLayer);
            }
        });

        // Do NOT auto-fit bounds — we want to keep the initial zoom level (satellite view)
    }).catch(err => {
        // Don't replace the map container content; keep the map visible even if GeoJSON fails.
        // Log the error for debugging and ensure the map is sized correctly.
        console.error('Map load error (countries GeoJSON):', err);
        try { map.invalidateSize(); } catch (e) {}
        // Optionally we could update a status element; for now we clear any status so no message shows.
        const statusEl = document.getElementById('map-status');
        if (statusEl) statusEl.textContent = '';
    });

})();
