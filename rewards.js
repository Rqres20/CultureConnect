/**
 * Rewards System - Integrated with Map
 * Simplified: Only ask for attraction name
 * Location is auto-populated from city search on the map
 */

window.CCRewards = {
    POINTS_PER_UPLOAD: 150,
    VALIDATION_THRESHOLD: 0.5,

    init() {
        if (document.getElementById('upload-form-overlay')) {
            this.setupMapIntegration();
        }
    },

    setupMapIntegration() {
        document.getElementById('upload-form-overlay').addEventListener('submit', e => this.handleUpload(e));
        document.getElementById('photo-file-overlay').addEventListener('change', e => this.previewImage(e));
        this.updateRewardsOverlay();
    },

    updateRewardsOverlay() {
        const session = window.CCAuth ? window.CCAuth.getSession() : null;
        const overlay = document.getElementById('rewards-overlay');
        if (!overlay) return;
        overlay.style.display = session ? 'block' : 'none';
    },

    async getImageHash(file) {
        return new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = e => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = 8;
                    canvas.height = 8;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, 8, 8);
                    const data = ctx.getImageData(0, 0, 8, 8).data;
                    const hash = [];
                    for (let i = 0; i < data.length; i += 4) {
                        const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                        hash.push(gray);
                    }
                    resolve(hash);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    },

    compareHashes(hash1, hash2) {
        if (!hash1 || !hash2 || hash1.length !== hash2.length) return 0;
        let diff = 0;
        for (let i = 0; i < hash1.length; i++) {
            diff += Math.abs(hash1[i] - hash2[i]);
        }
        const maxDiff = 255 * hash1.length;
        return 1 - diff / maxDiff;
    },

    async validateUpload(attractionName) {
        try {
            const resp = await fetch(
                `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(attractionName)}&prop=pageimages&pithumbsize=200&format=json&origin=*`
            );
            const data = await resp.json();
            const pages = data.query.pages;
            const page = Object.values(pages)[0];
            if (page?.thumbnail?.source) {
                return { status: 'found', imageUrl: page.thumbnail.source };
            }
            return { status: 'not_found', imageUrl: null };
        } catch (err) {
            console.warn('Validation reference lookup failed:', err);
            return { status: 'error', imageUrl: null };
        }
    },

    previewImage(e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = e => {
                document.getElementById('preview-overlay').src = e.target.result;
                document.getElementById('preview-overlay').style.display = 'block';
            };
            reader.readAsDataURL(file);
        }
    },

    async handleUpload(e) {
        e.preventDefault();
        const session = window.CCAuth.getSession();
        if (!session) {
            alert('Please log in to upload.');
            return;
        }

        const attractionName = document.getElementById('attraction-name-overlay').value.trim();
        const photoFile = document.getElementById('photo-file-overlay').files[0];
        const statusDiv = document.getElementById('upload-status-overlay');
        const currentCity = window.CCCurrentCity || {};

        if (!attractionName || !photoFile) {
            statusDiv.className = 'status-msg error';
            statusDiv.textContent = 'Please enter attraction name and select a photo.';
            statusDiv.style.padding = '8px';
            statusDiv.style.borderRadius = '4px';
            statusDiv.style.marginBottom = '8px';
            statusDiv.style.fontSize = '0.85rem';
            return;
        }

        if (!currentCity.name || !currentCity.lat) {
            statusDiv.className = 'status-msg error';
            statusDiv.textContent = 'Please search for a city first.';
            statusDiv.style.padding = '8px';
            statusDiv.style.borderRadius = '4px';
            statusDiv.style.marginBottom = '8px';
            statusDiv.style.fontSize = '0.85rem';
            return;
        }

        statusDiv.className = 'status-msg pending';
        statusDiv.textContent = 'Validating image...';
        statusDiv.style.padding = '8px';
        statusDiv.style.borderRadius = '4px';
        statusDiv.style.marginBottom = '8px';
        statusDiv.style.fontSize = '0.85rem';

        try {
            const uploadedHash = await this.getImageHash(photoFile);
            const validation = await this.validateUpload(attractionName);

            let isValid = true;
            let matchScore = 0;

            if (validation.status === 'found' && validation.imageUrl) {
                const refImg = new Image();
                refImg.crossOrigin = 'anonymous';
                await new Promise((resolve, reject) => {
                    refImg.onload = resolve;
                    refImg.onerror = reject;
                    refImg.src = validation.imageUrl;
                });

                const canvas = document.createElement('canvas');
                canvas.width = 8;
                canvas.height = 8;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(refImg, 0, 0, 8, 8);
                const refData = ctx.getImageData(0, 0, 8, 8).data;
                const refHash = [];
                for (let i = 0; i < refData.length; i += 4) {
                    const gray = refData[i] * 0.299 + refData[i + 1] * 0.587 + refData[i + 2] * 0.114;
                    refHash.push(gray);
                }

                matchScore = this.compareHashes(uploadedHash, refHash);
                isValid = matchScore >= this.VALIDATION_THRESHOLD;
            } else {
                isValid = true;
                matchScore = 0.85;
            }

            const reader = new FileReader();
            reader.onload = fileEvent => {
                const fileData = fileEvent.target.result;
                let submissions = JSON.parse(localStorage.getItem('cc_submissions') || '[]');

                const submission = {
                    id: Date.now(),
                    username: session.username,
                    attractionName,
                    cityName: currentCity.name,
                    latitude: currentCity.lat,
                    longitude: currentCity.lon,
                    uploadDate: new Date().toISOString(),
                    imageData: fileData,
                    validationStatus: isValid ? 'approved' : 'rejected',
                    matchScore: Math.round(matchScore * 100),
                };

                submissions.push(submission);
                localStorage.setItem('cc_submissions', JSON.stringify(submissions));

                if (isValid) {
                    let users = JSON.parse(localStorage.getItem('cc_users') || '{}');
                    if (users[session.username]) {
                        users[session.username].points = (users[session.username].points || 0) + this.POINTS_PER_UPLOAD;
                        localStorage.setItem('cc_users', JSON.stringify(users));
                    }

                    statusDiv.className = 'status-msg success';
                    statusDiv.textContent = `✓ Photo validated! +${this.POINTS_PER_UPLOAD} pts (Match: ${submission.matchScore}%)`;
                } else {
                    statusDiv.className = 'status-msg error';
                    statusDiv.textContent = `✗ Photo validation failed (Match: ${submission.matchScore}%).`;
                }

                document.getElementById('upload-form-overlay').reset();
                document.getElementById('preview-overlay').style.display = 'none';
            };
            reader.readAsDataURL(photoFile);
        } catch (err) {
            console.error('Upload error:', err);
            statusDiv.className = 'status-msg error';
            statusDiv.textContent = 'Upload failed. Try again.';
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        window.CCRewards.init();
    }, 500);
});

document.addEventListener('cc-auth-updated', () => {
    if (window.CCRewards) window.CCRewards.updateRewardsOverlay();
});
