// Lightweight auth with local email verification (simulated). Replace with Firebase for real emails.
window.CCAuth = (function() {
    const STORAGE_USERS = 'cc_users';
    const STORAGE_SESSION = 'cc_session';

    // Toggle to true and fill firebase config below to use Firebase Auth (real email verification)
    const USE_FIREBASE = false;
    const FIREBASE_CONFIG = {
        // apiKey: "...", authDomain: "...", projectId: "...", ...
    };

    // Helpers
    function readUsers() { return JSON.parse(localStorage.getItem(STORAGE_USERS) || '{}'); }

    function writeUsers(u) { localStorage.setItem(STORAGE_USERS, JSON.stringify(u)); }

    function setSession(email) {
        localStorage.setItem(STORAGE_SESSION, JSON.stringify({ email }));
        dispatchAuthUpdate();
    }

    function clearSession() {
        localStorage.removeItem(STORAGE_SESSION);
        dispatchAuthUpdate();
    }

    function getSessionObj() { try { return JSON.parse(localStorage.getItem(STORAGE_SESSION)); } catch { return null; } }

    function dispatchAuthUpdate() { document.dispatchEvent(new Event('cc-auth-updated')); }

    // Password hash (SHA-256)
    async function hashPassword(password) {
        const enc = new TextEncoder().encode(password);
        const buf = await crypto.subtle.digest('SHA-256', enc);
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function genCode() { return Math.floor(100000 + Math.random() * 900000).toString(); }

    // Local user model: { email, name, passwordHash, points, verified, verificationCode, verificationExpires }
    async function registerLocal(name, email, password) {
        const users = readUsers();
        if (users[email]) throw new Error('Email already registered');
        if (password.length < 6) throw new Error('Password too short');
        const passwordHash = await hashPassword(password);
        const code = genCode();
        const expires = Date.now() + 15 * 60 * 1000;
        users[email] = { email, name, passwordHash, points: 0, verified: false, verificationCode: code, verificationExpires: expires };
        writeUsers(users);
        // "Send" code: for local mode we return it so UI can display (simulate email)
        return { verificationCode: code };
    }

    async function loginLocal(email, password) {
        const users = readUsers();
        const u = users[email];
        if (!u) throw new Error('User not found');
        const hash = await hashPassword(password);
        if (hash !== u.passwordHash) throw new Error('Invalid credentials');
        if (!u.verified) throw new Error('EMAIL_NOT_VERIFIED');
        setSession(email);
        return { email: u.email, name: u.name };
    }

    async function sendVerificationLocal(email) {
        const users = readUsers();
        const u = users[email];
        if (!u) throw new Error('User not found');
        const code = genCode();
        u.verificationCode = code;
        u.verificationExpires = Date.now() + 15 * 60 * 1000;
        users[email] = u;
        writeUsers(users);
        // Simulated send: return code so UI can show it for testing
        return { verificationCode: code };
    }

    async function verifyCodeLocal(email, code) {
        const users = readUsers();
        const u = users[email];
        if (!u) throw new Error('User not found');
        if (u.verificationExpires < Date.now()) throw new Error('Code expired');
        if (u.verificationCode !== code) throw new Error('Invalid code');
        u.verified = true;
        u.verificationCode = null;
        u.verificationExpires = null;
        users[email] = u;
        writeUsers(users);
        return true;
    }

    // Public API used by pages
    const api = {
        init() {
            // Bind UI if login.html present
            const tabLogin = document.getElementById('tab-login');
            const tabRegister = document.getElementById('tab-register');
            if (tabLogin && tabRegister) {
                const fLogin = document.getElementById('form-login');
                const fReg = document.getElementById('form-register');
                const statusLogin = document.getElementById('login-status');
                const statusReg = document.getElementById('reg-status');
                const verifyPanel = document.getElementById('verify-panel');
                const verifyStatus = document.getElementById('verify-status');

                function showStatus(el, msg, cls) {
                    el.className = 'status ' + cls;
                    el.textContent = msg;
                    // auto-hide success
                    if (cls === 'success') setTimeout(() => { el.style.display = 'none'; }, 3000);
                    el.style.display = 'block';
                }

                tabLogin.onclick = () => {
                    tabLogin.classList.add('active');
                    tabRegister.classList.remove('active');
                    fLogin.classList.add('active');
                    fReg.classList.remove('active');
                };
                tabRegister.onclick = () => {
                    tabRegister.classList.add('active');
                    tabLogin.classList.remove('active');
                    fReg.classList.add('active');
                    fLogin.classList.remove('active');
                };

                document.getElementById('btn-register').onclick = async() => {
                    statusReg.style.display = 'none';
                    try {
                        const name = document.getElementById('reg-name').value.trim();
                        const email = document.getElementById('reg-email').value.trim().toLowerCase();
                        const pw = document.getElementById('reg-password').value;
                        const pw2 = document.getElementById('reg-password2').value;
                        if (!name || !email || !pw) throw new Error('Fill all fields');
                        if (pw !== pw2) throw new Error('Passwords do not match');
                        const r = await registerLocal(name, email, pw);
                        showStatus(statusReg, 'Registered. Verification code sent (simulated).', 'success');
                        // show verify panel and display code for local testing
                        verifyPanel.style.display = 'block';
                        verifyStatus.className = 'status info';
                        verifyStatus.style.display = 'block';
                        verifyStatus.textContent = `Simulated code: ${r.verificationCode} — enter it below or press Resend.`;
                        // store last email to verify
                        verifyPanel.dataset.email = email;
                    } catch (err) {
                        showStatus(statusReg, err.message || err, 'error');
                    }
                };

                document.getElementById('btn-login').onclick = async() => {
                    statusLogin.style.display = 'none';
                    try {
                        const email = document.getElementById('login-email').value.trim().toLowerCase();
                        const pw = document.getElementById('login-password').value;
                        const r = await loginLocal(email, pw);
                        showStatus(statusLogin, 'Logged in as ' + r.name, 'success');

                        // Notify app that auth changed and redirect to main page
                        dispatchAuthUpdate();
                        setTimeout(() => {
                            // go to homepage (or use location.reload() if already on main page)
                            window.location.href = 'index.html';
                        }, 400);
                    } catch (err) {
                        if (err.message === 'EMAIL_NOT_VERIFIED') {
                            // prompt verification
                            verifyPanel.style.display = 'block';
                            verifyPanel.dataset.email = document.getElementById('login-email').value.trim().toLowerCase();
                            verifyStatus.className = 'status info';
                            verifyStatus.style.display = 'block';
                            verifyStatus.textContent = 'Email not verified. A code was sent (simulated).';
                            // also "send" a new code
                            try {
                                const r = await sendVerificationLocal(verifyPanel.dataset.email);
                                verifyStatus.textContent = `Simulated code: ${r.verificationCode}`;
                            } catch (e) { console.warn(e); }
                            showStatus(statusLogin, 'Email not verified — check code below.', 'error');
                        } else {
                            showStatus(statusLogin, err.message || err, 'error');
                        }
                    }
                };

                document.getElementById('btn-resend').onclick = async() => {
                    try {
                        const email = verifyPanel.dataset.email;
                        if (!email) throw new Error('No email to resend to');
                        const r = await sendVerificationLocal(email);
                        verifyStatus.className = 'status info';
                        verifyStatus.textContent = `Simulated code resent: ${r.verificationCode}`;
                    } catch (err) {
                        verifyStatus.className = 'status error';
                        verifyStatus.textContent = err.message || err;
                    }
                };

                document.getElementById('btn-verify').onclick = async() => {
                    const code = document.getElementById('verify-code-input').value.trim();
                    const email = verifyPanel.dataset.email;
                    if (!email) {
                        verifyStatus.className = 'status error';
                        verifyStatus.textContent = 'No email to verify';
                        return;
                    }
                    try {
                        await verifyCodeLocal(email, code);
                        verifyStatus.className = 'status success';
                        verifyStatus.textContent = 'Email verified. You can now login.';
                        // auto-login after verify
                        setTimeout(async() => {
                            try {
                                const pwField = document.getElementById('login-password');
                                // only auto-login if user has entered pw in login form
                                if (pwField && pwField.value) {
                                    await loginLocal(email, pwField.value);
                                    dispatchAuthUpdate();
                                }
                            } catch (_) { /* ignore */ }
                        }, 500);
                    } catch (err) {
                        verifyStatus.className = 'status error';
                        verifyStatus.textContent = err.message || err;
                    }
                };

                document.getElementById('btn-logout').onclick = () => {
                    clearSession();
                    document.getElementById('signed-in-panel').style.display = 'none';
                    document.getElementById('auth-center').style.display = '';
                };
            }

            // If other pages need to react, dispatch update on load
            dispatchAuthUpdate();

            // --- NEW: keep nav/UI in sync with current session ---
            // update nav immediately and on auth changes
            if (typeof api.updateNav === 'function') api.updateNav();
            document.addEventListener('cc-auth-updated', () => { if (typeof api.updateNav === 'function') api.updateNav(); });
        },

        // Exposed methods for other pages
        async register(name, email, password) { return registerLocal(name, email.toLowerCase(), password); },
        async login(email, password) { return loginLocal(email.toLowerCase(), password); },
        logout() { clearSession(); },
        getSession() {
            const s = getSessionObj();
            if (!s) return null;
            const users = readUsers();
            const u = users[s.email];
            // Return the email as the session identifier (used as key in cc_users)
            return u ? s.email : null;
        },
        // New: return a friendly display name for UI
        getDisplayName() {
            const s = getSessionObj();
            if (!s) return null;
            const users = readUsers();
            const u = users[s.email];
            return u ? (u.name || s.email) : null;
        },
        currentEmail() {
            const s = getSessionObj();
            return s ? s.email : null;
        },
        async sendVerification(email) { return sendVerificationLocal(email.toLowerCase()); },
        async verifyCode(email, code) { return verifyCodeLocal(email.toLowerCase(), code); },

        // New: update site nav to reflect login state
        updateNav() {
            try {
                const session = api.getSession(); // returns email or null
                const navAuthLink = document.getElementById('nav-auth-link');
                const currentUserSpan = document.getElementById('current-user');

                if (navAuthLink) {
                    if (session) {
                        navAuthLink.textContent = 'Logout';
                        navAuthLink.href = '#';
                        navAuthLink.onclick = (ev) => {
                            ev.preventDefault();
                            api.logout();
                            // keep UI in sync
                            api.updateNav();
                            // optional: go to home
                            window.location.href = 'index.html';
                            return false;
                        };
                    } else {
                        navAuthLink.textContent = 'Login';
                        navAuthLink.href = 'login.html';
                        navAuthLink.onclick = null;
                    }
                }

                if (currentUserSpan) {
                    currentUserSpan.textContent = session ? api.getDisplayName() : '';
                }
            } catch (e) {
                console.warn('updateNav error', e);
            }
        },
    };

    return api;
})();