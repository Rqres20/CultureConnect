// Rewards page: upload, autocomplete, delete, improved image validation
window.CCRewardsFull = {
    POINTS_PER_UPLOAD: 150,
    VALIDATION_THRESHOLD: 0.62,
    // Cache for Wikipedia thumbnails & hashes to avoid re-fetching
    _hashCache: {},
    _thumbnailCache: {},

    init() {
        this.setupAutocomplete();
        this.setupAttractionDropdown();
        document.getElementById('upload-form').addEventListener('submit', e => this.handleUpload(e));
        document.getElementById('photo-file').addEventListener('change', e => this.previewImage(e));
        this.updateStats();
        setInterval(() => this.updateStats(), 2000);
    },

    // --- Autocomplete for city and attraction ---
    setupAutocomplete() {
        const cityInput = document.getElementById('city-name');
        const cityBox = document.getElementById('city-suggestions');
        let cityResults = [];
        cityInput.addEventListener('input', this.debounce(async e => {
            const q = cityInput.value.trim();
            if (!q) { cityBox.style.display = 'none'; return; }
            const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=6&q=' + encodeURIComponent(q);
            const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
            const data = await res.json();
            cityResults = data || [];
            cityBox.innerHTML = cityResults.map((c, i) => `<div class='suggestion-item' data-i='${i}'>${c.display_name}</div>`).join('');
            cityBox.style.display = cityResults.length ? 'block' : 'none';
        }, 300));
        cityBox.addEventListener('click', async e => {
            if (e.target.classList.contains('suggestion-item')) {
                const i = +e.target.dataset.i;
                cityInput.value = cityResults[i].display_name.split(',')[0];
                cityInput.dataset.lat = cityResults[i].lat;
                cityInput.dataset.lon = cityResults[i].lon;
                cityBox.style.display = 'none';
                // Populate attractions for this city
                await window.CCRewardsFull.populateAttractions(cityResults[i].lat, cityResults[i].lon);
            }
        });
        document.addEventListener('click', e => { if (!cityBox.contains(e.target) && e.target !== cityInput) cityBox.style.display = 'none'; });
        // Clear attractions if city is cleared
        cityInput.addEventListener('change', () => {
            if (!cityInput.value.trim()) {
                const attractionInput = document.getElementById('attraction-input');
                const attractionList = document.getElementById('attraction-list');
                attractionInput.value = '';
                attractionInput.placeholder = 'Start typing to see attractions';
                attractionInput.disabled = true;
                attractionList.innerHTML = '';
            }
        });
    },

    setupAttractionDropdown() {
        const cityInput = document.getElementById('city-name');
        cityInput.addEventListener('blur', () => {
            setTimeout(() => {
                if (!cityInput.value.trim()) {
                    const attractionInput = document.getElementById('attraction-input');
                    const attractionList = document.getElementById('attraction-list');
                    attractionInput.value = '';
                    attractionInput.placeholder = 'Start typing to see attractions';
                    attractionInput.disabled = true;
                    attractionList.innerHTML = '';
                }
            }, 200);
        });
    },

    async populateAttractions(lat, lon) {
        const attractionInput = document.getElementById('attraction-input');
        const attractionList = document.getElementById('attraction-list');
        attractionInput.placeholder = 'Loading attractions...';
        attractionInput.value = '';
        attractionInput.disabled = true;
        attractionList.innerHTML = '';
        if (!lat || !lon || isNaN(Number(lat)) || isNaN(Number(lon))) {
            console.warn('populateAttractions called with invalid coordinates:', lat, lon);
            attractionList.innerHTML = '';
            attractionInput.disabled = true;
            attractionInput.placeholder = 'Error: invalid city coordinates';
            return;
        }

        const query = `[out:json][timeout:12];(\n            node["tourism"~"attraction|museum|gallery|zoo|theme_park"](around:8000,${lat},${lon});\n            node["historic"](around:8000,${lat},${lon});\n            node["amenity"="place_of_worship"](around:8000,${lat},${lon});\n        );out body;`;

        const endpoints = [
            'https://overpass-api.de/api/interpreter',
            'https://overpass.openstreetmap.fr/api/interpreter',
            'https://overpass.kumi.systems/api/interpreter'
        ];

        let lastError = null;
        for (const endpoint of endpoints) {
            try {
                console.log('Fetching attractions from', endpoint, 'for', lat, lon);
                const res = await fetch(endpoint, {
                    method: 'POST',
                    body: query,
                    headers: { 'Content-Type': 'text/plain' }
                });
                if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
                const data = await res.json();
                const names = [...new Set((data.elements || []).map(e => e.tags && e.tags.name).filter(Boolean))];
                if (names.length) {
                    attractionList.innerHTML = names.map(n => `<option value="${n.replace(/"/g,'&quot;')}"></option>`).join('');
                    attractionInput.disabled = false;
                    attractionInput.placeholder = 'Start typing to see attractions';
                    console.log('Loaded', names.length, 'attractions from', endpoint);
                    return;
                } else {
                    lastError = new Error('No attractions found');
                    console.log('No attractions found at', endpoint);
                }
            } catch (err) {
                console.warn('Overpass request failed for', endpoint, err.message || err);
                lastError = err;
            }
        }

        attractionList.innerHTML = '';
        attractionInput.disabled = true;
        if (lastError) {
            attractionInput.placeholder = `Error loading attractions: ${lastError.message || lastError}`;
        } else {
            attractionInput.placeholder = 'No attractions found for this city';
        }
    },
    debounce(fn, wait) {
        let t;
        return function(...a) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, a), wait);
        }
    },

    // --- Image preview ---
    previewImage(e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = e => {
                document.getElementById('preview-img').src = e.target.result;
                document.getElementById('preview-img').style.display = 'block';
            };
            reader.readAsDataURL(file);
        }
    },

    // --- OPTIMIZED: Faster dHash with reduced size ---
    async getImageDHash(file) {
        return new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = e => {
                const img = new Image();
                img.onload = () => {
                    const w = 8,
                        h = 8; // Reduced from 9x8
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    const data = ctx.getImageData(0, 0, w, h).data;
                    let hash = '';
                    for (let y = 0; y < h; y++) {
                        for (let x = 0; x < w - 1; x++) {
                            const i1 = 4 * (y * w + x),
                                i2 = 4 * (y * w + x + 1);
                            const g1 = data[i1] * 0.3 + data[i1 + 1] * 0.59 + data[i1 + 2] * 0.11;
                            const g2 = data[i2] * 0.3 + data[i2 + 1] * 0.59 + data[i2 + 2] * 0.11;
                            hash += g1 > g2 ? '1' : '0';
                        }
                    }
                    resolve(hash);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    },
    hamming(a, b) {
        let d = 0;
        for (let i = 0; i < a.length; i++)
            if (a[i] !== b[i]) d++;
        return d;
    },
    dhashSimilarity(a, b) { if (!a || !b || a.length !== b.length) return 0; return 1 - this.hamming(a, b) / a.length; },

    // --- OPTIMIZED: Cached Wikipedia fetch ---
    async fetchWikipediaThumbnail(attraction) {
        if (this._thumbnailCache[attraction]) {
            return this._thumbnailCache[attraction];
        }

        try {
            const titleUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(attraction)}&prop=pageimages&pithumbsize=400&format=json&origin=*`;
            const resp = await fetch(titleUrl);
            const data = await resp.json();
            const pages = data.query && data.query.pages ? data.query.pages : null;
            if (pages) {
                const page = Object.values(pages)[0];
                if (page && page.thumbnail && page.thumbnail.source) {
                    this._thumbnailCache[attraction] = page.thumbnail.source;
                    return page.thumbnail.source;
                }
            }
        } catch (e) {
            console.warn('Wikipedia title lookup failed:', e);
        }

        try {
            const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(attraction)}&srlimit=1&format=json&origin=*`;
            const sresp = await fetch(searchUrl);
            const sdata = await sresp.json();
            const hits = sdata.query && sdata.query.search ? sdata.query.search : [];
            if (hits.length) {
                const best = hits[0];
                if (best && best.title) {
                    const pageImgUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(best.title)}&prop=pageimages&pithumbsize=400&format=json&origin=*`;
                    const presp = await fetch(pageImgUrl);
                    const pdata = await presp.json();
                    const ppages = pdata.query && pdata.query.pages ? pdata.query.pages : null;
                    if (ppages) {
                        const ppage = Object.values(ppages)[0];
                        if (ppage && ppage.thumbnail && ppage.thumbnail.source) {
                            this._thumbnailCache[attraction] = ppage.thumbnail.source;
                            return ppage.thumbnail.source;
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('Wikipedia search fallback failed:', e);
        }
        return null;
    },

    async getImageDHashFromUrl(url) {
        return new Promise(resolve => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const w = 8,
                    h = 8; // Reduced from 9x8
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                const data = ctx.getImageData(0, 0, w, h).data;
                let hash = '';
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w - 1; x++) {
                        const i1 = 4 * (y * w + x),
                            i2 = 4 * (y * w + x + 1);
                        const g1 = data[i1] * 0.3 + data[i1 + 1] * 0.59 + data[i1 + 2] * 0.11;
                        const g2 = data[i2] * 0.3 + data[i2 + 1] * 0.59 + data[i2 + 2] * 0.11;
                        hash += g1 > g2 ? '1' : '0';
                    }
                }
                resolve(hash);
            };
            img.onerror = () => resolve(null);
            img.src = url;
        });
    },

    // --- OPTIMIZED: Faster histogram (reduced size & bins) ---
    getImageHistogram(fileOrUrl) {
        return new Promise(resolve => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = 16;
                canvas.height = 16; // Reduced from 32x32
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, 16, 16);
                const data = ctx.getImageData(0, 0, 16, 16).data;
                const bins = 4,
                    hist = [
                        [],
                        [],
                        []
                    ]; // Reduced from 8 to 4 bins
                for (let i = 0; i < bins; i++) hist[0][i] = hist[1][i] = hist[2][i] = 0;
                for (let i = 0; i < data.length; i += 4) {
                    hist[0][data[i] >> 6]++;
                    hist[1][data[i + 1] >> 6]++;
                    hist[2][data[i + 2] >> 6]++;
                }
                const total = 16 * 16;
                for (let c = 0; c < 3; c++)
                    for (let i = 0; i < bins; i++) hist[c][i] /= total;
                resolve(hist.flat());
            };
            if (typeof fileOrUrl === 'string') img.src = fileOrUrl;
            else {
                const reader = new FileReader();
                reader.onload = e => { img.src = e.target.result; };
                reader.readAsDataURL(fileOrUrl);
            }
        });
    },
    histogramSimilarity(a, b) {
        if (!a || !b || a.length !== b.length) return 0;
        let sum = 0;
        for (let i = 0; i < a.length; i++) sum += Math.min(a[i], b[i]);
        return Math.min(1, sum / 3);
    },

    async handleUpload(e) {
        e.preventDefault();
        const session = window.CCAuth.getSession();
        if (!session) return;
        const city = document.getElementById('city-name').value.trim();
        const attractionInput = document.getElementById('attraction-input');
        const attractionList = document.getElementById('attraction-list');
        const attraction = (attractionInput && attractionInput.value) ? attractionInput.value.trim() : '';
        const file = document.getElementById('photo-file').files[0];
        const statusDiv = document.getElementById('upload-status');

        if (!city || !attraction || !file) {
            statusDiv.className = 'status-msg error';
            statusDiv.textContent = 'Please fill in all fields.';
            return;
        }

        const validOption = attractionList && [...attractionList.options].some(opt => opt.value === attraction && opt.value);
        if (!attractionInput || attractionInput.disabled || !validOption) {
            statusDiv.className = 'status-msg error';
            statusDiv.textContent = 'Please select a valid attraction from the list.';
            return;
        }

        statusDiv.className = 'status-msg pending';
        statusDiv.textContent = 'Validating image... ⚡';

        try {
            let refImgUrl = null;
            try {
                refImgUrl = await this.fetchWikipediaThumbnail(attraction);
            } catch (e) {
                console.warn('Error fetching reference thumbnail:', e);
            }

            if (!refImgUrl) {
                statusDiv.className = 'status-msg error';
                statusDiv.textContent = 'No reference image found for this attraction. Upload rejected.';
                return;
            }

            // OPTIMIZED: Run validations in PARALLEL using Promise.all
            const [userHash, refHash, userHist, refHist] = await Promise.all([
                this.getImageDHash(file),
                this.getImageDHashFromUrl(refImgUrl),
                this.getImageHistogram(file),
                this.getImageHistogram(refImgUrl)
            ]);

            const dhashScore = this.dhashSimilarity(userHash, refHash);
            const histScore = this.histogramSimilarity(userHist, refHist);
            //THRESHOLDS
            const isValid = dhashScore >= 0.50 && histScore >= 0.50;

            const reader = new FileReader();
            reader.onload = fileEvent => {
                const fileData = fileEvent.target.result;
                let submissions = JSON.parse(localStorage.getItem('cc_submissions') || '[]');
                const submission = {
                    id: Date.now(),
                    username: session,
                    attractionName: attraction,
                    cityName: city,
                    uploadDate: new Date().toISOString(),
                    imageData: fileData,
                    validationStatus: isValid ? 'approved' : 'rejected',
                    matchScore: Math.round(dhashScore * 100),
                    histScore: Math.round(histScore * 100)
                };
                submissions.push(submission);
                localStorage.setItem('cc_submissions', JSON.stringify(submissions)); 


                if (isValid) {
                    let users = JSON.parse(localStorage.getItem('cc_users') || '{}');
                    if (users[session]) {
                        users[session].points = (users[session].points || 0) + this.POINTS_PER_UPLOAD;
                        localStorage.setItem('cc_users', JSON.stringify(users));
                    }
                    statusDiv.className = 'status-msg success';
                    statusDiv.textContent = `✓ Photo validated! +${this.POINTS_PER_UPLOAD} pts (Match: ${submission.matchScore}%, Color: ${submission.histScore}%)`;
                } else {
                    statusDiv.className = 'status-msg error';
                    statusDiv.textContent = `✗ Photo too different. Match: ${Math.round(dhashScore*100)}%, Color: ${Math.round(histScore*100)}%. Try a clearer photo of the same attraction.`;
                }
                document.getElementById('upload-form').reset();
                document.getElementById('preview-img').style.display = 'none';
                setTimeout(() => { statusDiv.textContent = ''; }, 3500);
                window.CCRewardsFull.updateStats();
            };
            reader.readAsDataURL(file);
        } catch (err) {
            statusDiv.className = 'status-msg error';
            statusDiv.textContent = 'Upload failed. Try again.';
            console.error(err);
        }
    },

    updateStats() {
        const session = window.CCAuth ? window.CCAuth.getSession() : null;
        const authRequired = document.getElementById('auth-required');
        const rewardsContent = document.getElementById('rewards-content');
        if (!authRequired || !rewardsContent) return;
        if (!session) {
            authRequired.style.display = 'block';
            rewardsContent.style.display = 'none';
            return;
        }
        authRequired.style.display = 'none';
        rewardsContent.style.display = 'block';
        const users = JSON.parse(localStorage.getItem('cc_users') || '{}');
        const userPoints = (users[session] && users[session].points) || 0;
        const submissions = JSON.parse(localStorage.getItem('cc_submissions') || '[]');
        const userUploads = submissions.filter(s => s.username === session && s.validationStatus === 'approved').length;
        const pointsDiv = document.getElementById('user-points');
        const uploadsDiv = document.getElementById('user-uploads');
        if (pointsDiv) pointsDiv.textContent = userPoints.toLocaleString();
        if (uploadsDiv) uploadsDiv.textContent = `${userUploads} approved upload${userUploads !== 1 ? 's' : ''}`;

        const leaderboardDiv = document.getElementById('leaderboard');
        if (!leaderboardDiv) return;
        const userStats = {};
        submissions.filter(s => s.validationStatus === 'approved').forEach(s => {
            if (!userStats[s.username]) userStats[s.username] = { points: 0, uploads: 0 };
            userStats[s.username].points += this.POINTS_PER_UPLOAD;
            userStats[s.username].uploads += 1;
        });
        const sorted = Object.entries(userStats).map(([username, stats]) => ({ username, ...stats })).sort((a, b) => b.points - a.points).slice(0, 10);
        if (sorted.length === 0) {
            leaderboardDiv.innerHTML = '<p style="color:#666; text-align:center;"><em>No validated submissions yet.</em></p>';
        } else {
            leaderboardDiv.innerHTML = sorted.map((entry, idx) => {
                let badge = '';
                if (idx === 0) badge = '<span class="badge gold">🥇</span>';
                else if (idx === 1) badge = '<span class="badge silver">🥈</span>';
                else if (idx === 2) badge = '<span class="badge bronze">🥉</span>';
                return `<div class="leaderboard-item"><span>${badge} <strong>${entry.username}</strong></span><span><strong>${entry.points}</strong> pts</span></div>`;
            }).join('');
        }

        const recentDiv = document.getElementById('recent-uploads');
        if (!recentDiv) return;
        const userSubmissions = submissions.filter(s => s.validationStatus === 'approved' && s.username === session).sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate)).slice(0, 12);
        if (userSubmissions.length === 0) {
            recentDiv.innerHTML = '<p style="color:#666; grid-column: 1/-1; text-align:center;"><em>No approved submissions yet.</em></p>';
        } else {
            recentDiv.innerHTML = userSubmissions.map(s => `
                    <div style="text-align:center; position:relative;">
                        <img src="${s.imageData}" style="width:100%; border-radius:6px; margin-bottom:8px; max-height:150px; object-fit:cover;" />
                        <button class="delete-photo-btn" data-id="${s.id}" style="position:absolute;top:6px;right:6px;background:#f44336;color:#fff;border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:1.1rem;">&times;</button>
                        <p style="font-size:0.85rem; margin:4px 0; font-weight:600;">${s.attractionName}</p>
                        <p style="font-size:0.75rem; color:#666; margin:0;">${s.cityName}</p>
                        <p style="font-size:0.75rem; color:#8B5FFF; margin:4px 0;"><strong>+${this.POINTS_PER_UPLOAD}</strong></p>
                    </div>
                `).join('');
            recentDiv.querySelectorAll('.delete-photo-btn').forEach(btn => {
                btn.onclick = e => {
                    if (confirm('Delete this photo?')) {
                        this.deletePhoto(+btn.dataset.id);
                    }
                };
            });
        }
    },
    deletePhoto(id) {
        let submissions = JSON.parse(localStorage.getItem('cc_submissions') || '[]');
        const idx = submissions.findIndex(s => s.id === id);
        if (idx !== -1) {
            const s = submissions[idx];
            if (s.validationStatus === 'approved') {
                let users = JSON.parse(localStorage.getItem('cc_users') || '{}');
                if (users[s.username]) {
                    users[s.username].points = Math.max(0, (users[s.username].points || 0) - this.POINTS_PER_UPLOAD);
                    localStorage.setItem('cc_users', JSON.stringify(users));
                }
            }
            submissions.splice(idx, 1);
            localStorage.setItem('cc_submissions', JSON.stringify(submissions));
            this.updateStats();
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    if (window.CCRewardsFull) window.CCRewardsFull.init();
});
document.addEventListener('cc-auth-updated', () => {
    if (window.CCRewardsFull) window.CCRewardsFull.updateStats();
});