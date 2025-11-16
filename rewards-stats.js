/**
 * Rewards Stats Page - Display leaderboard and user stats
 * Upload is on the Map page
 */

window.CCRewardsStats = {
    POINTS_PER_UPLOAD: 150,

    init() {
        this.updateStats();
        // Update every 2 seconds to reflect new uploads
        setInterval(() => this.updateStats(), 2000);
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

        // Get user points
        const users = JSON.parse(localStorage.getItem('cc_users') || '{}');
        const userPoints = users[session]?.points || 0;
        
        const submissions = JSON.parse(localStorage.getItem('cc_submissions') || '[]');
        const userUploads = submissions
            .filter(s => s.username === session && s.validationStatus === 'approved').length;

        const pointsDiv = document.getElementById('user-points');
        const uploadsDiv = document.getElementById('user-uploads');
        if (pointsDiv) pointsDiv.textContent = userPoints.toLocaleString();
        if (uploadsDiv) uploadsDiv.textContent = `${userUploads} approved upload${userUploads !== 1 ? 's' : ''}`;

        // Build leaderboard
        const leaderboardDiv = document.getElementById('leaderboard');
        if (!leaderboardDiv) return;

        // Aggregate points by user
        const userStats = {};
        submissions
            .filter(s => s.validationStatus === 'approved')
            .forEach(s => {
                if (!userStats[s.username]) {
                    userStats[s.username] = { points: 0, uploads: 0 };
                }
                userStats[s.username].points += this.POINTS_PER_UPLOAD;
                userStats[s.username].uploads += 1;
            });

        const sorted = Object.entries(userStats)
            .map(([username, stats]) => ({ username, ...stats }))
            .sort((a, b) => b.points - a.points)
            .slice(0, 10);

        if (sorted.length === 0) {
            leaderboardDiv.innerHTML = '<p style="color:#666; text-align:center;"><em>No validated submissions yet.</em></p>';
        } else {
            leaderboardDiv.innerHTML = sorted
                .map((entry, idx) => {
                    let badge = '';
                    if (idx === 0) badge = '<span class="badge gold">🥇</span>';
                    else if (idx === 1) badge = '<span class="badge silver">🥈</span>';
                    else if (idx === 2) badge = '<span class="badge bronze">🥉</span>';

                    return `
                        <div class="leaderboard-item">
                            <span>${badge} <strong>${entry.username}</strong></span>
                            <span><strong>${entry.points}</strong> pts</span>
                        </div>
                    `;
                })
                .join('');
        }

        // Recent uploads
        const recentDiv = document.getElementById('recent-uploads');
        if (!recentDiv) return;

        const userSubmissions = submissions
            .filter(s => s.validationStatus === 'approved')
            .sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate))
            .slice(0, 12);

        if (userSubmissions.length === 0) {
            recentDiv.innerHTML = '<p style="color:#666; grid-column: 1/-1; text-align:center;"><em>No approved submissions yet.</em></p>';
        } else {
            recentDiv.innerHTML = userSubmissions
                .map(s => `
                    <div style="text-align:center;">
                        <img src="${s.imageData}" style="width:100%; border-radius:6px; margin-bottom:8px; max-height:150px; object-fit:cover;" />
                        <p style="font-size:0.85rem; margin:4px 0; font-weight:600;">${s.attractionName}</p>
                        <p style="font-size:0.75rem; color:#666; margin:0;">${s.cityName}</p>
                        <p style="font-size:0.75rem; color:#8B5FFF; margin:4px 0;"><strong>+${this.POINTS_PER_UPLOAD}</strong></p>
                    </div>
                `)
                .join('');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    if (window.CCRewardsStats) {
        window.CCRewardsStats.init();
    }
});

document.addEventListener('cc-auth-updated', () => {
    if (window.CCRewardsStats) window.CCRewardsStats.updateStats();
});
