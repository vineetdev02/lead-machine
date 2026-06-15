const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const otp    = require('otplib');
const fs     = require('fs');
const path   = require('path');

const COOKIE_NAME  = 'lh_session';
const TOKEN_TTL    = '24h';
const COOKIE_MAXMS = 24 * 60 * 60 * 1000;
const USERS_FILE   = path.join(__dirname, 'users.json');

const ADMIN_EMAIL   = process.env.ADMIN_EMAIL   || '';
const PASSWORD_HASH = process.env.PASSWORD_HASH || '';
const TOTP_SECRET   = process.env.TOTP_SECRET   || '';
const JWT_SECRET    = process.env.JWT_SECRET    || '';

const isConfigured = !!(ADMIN_EMAIL && PASSWORD_HASH && TOTP_SECRET && JWT_SECRET);

// ── User directory ──────────────────────────────────────────────────────────
// The env-based account is always the admin. Additional accounts (e.g. callers
// who manage leads but can't generate them or change settings) live in
// users.json — each { email, passwordHash, role }.
//
// 2FA is shared: every account (admin and agents) authenticates against the
// single owner-controlled TOTP_SECRET. Agents have no QR/secret of their own —
// they get the 6-digit code from the owner.
function loadUsers() {
  const users = [];
  if (ADMIN_EMAIL && PASSWORD_HASH && TOTP_SECRET) {
    users.push({ email: ADMIN_EMAIL, passwordHash: PASSWORD_HASH, role: 'admin' });
  }
  try {
    const arr = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    if (Array.isArray(arr)) {
      for (const u of arr) {
        if (u && u.email && u.passwordHash) {
          users.push({
            email: String(u.email),
            passwordHash: String(u.passwordHash),
            role: u.role === 'admin' ? 'admin' : 'agent',
          });
        }
      }
    }
  } catch { /* no users.json — env admin only */ }
  return users;
}

function findUser(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  return loadUsers().find(u => u.email.toLowerCase() === e) || null;
}
const IS_PROD = process.env.NODE_ENV === 'production';
if (!isConfigured) {
  if (IS_PROD) {
    console.error('[auth] FATAL: missing one of ADMIN_EMAIL / PASSWORD_HASH / TOTP_SECRET / JWT_SECRET in production. Refusing all requests.');
  } else {
    console.warn('[auth] Missing one of ADMIN_EMAIL / PASSWORD_HASH / TOTP_SECRET / JWT_SECRET — auth is OPEN (dev only).');
  }
}

function verifyTotp(code, secret) {
  if (!code || !secret) return false;
  // otplib v13's verify() is async (returns a Promise — always truthy). Use the
  // sync variant and read .valid, otherwise the 2FA check is silently bypassed.
  const result = otp.verifySync({ token: String(code).replace(/\s+/g,''), secret, encoding: 'base32', window: 1 });
  return !!(result && result.valid);
}

function signSession(email, role) {
  return jwt.sign({ sub: email, role: role || 'agent' }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function readSession(req) {
  const tok = req.cookies?.[COOKIE_NAME];
  if (!tok) return null;
  try { return jwt.verify(tok, JWT_SECRET); } catch { return null; }
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure:  process.env.NODE_ENV === 'production',
    maxAge:  COOKIE_MAXMS,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
}

// Middleware: gate everything that isn't login / static asset
function requireAuth(req, res, next) {
  if (!isConfigured) {
    if (IS_PROD) return res.status(503).send('Auth not configured. Set ADMIN_EMAIL / PASSWORD_HASH / TOTP_SECRET / JWT_SECRET.');
    return next(); // dev/local fallback only
  }
  if (readSession(req)) return next();
  // API → 401, page → redirect to /login
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
  if (req.accepts('html')) return res.redirect('/login');
  return res.status(401).end();
}

function mountRoutes(app) {
  app.post('/api/auth/login', async (req, res) => {
    if (!isConfigured) return res.status(500).json({ error: 'auth not configured on server' });
    const { email, password, code } = req.body || {};
    if (!email || !password || !code) return res.status(400).json({ error: 'email, password, code required' });
    const user = findUser(email);
    if (!user) return res.status(401).json({ error: 'invalid credentials' });
    const passOk = await bcrypt.compare(password, user.passwordHash);
    if (!passOk) return res.status(401).json({ error: 'invalid credentials' });
    // Single shared 2FA: every account (admin + agents) verifies against the
    // owner's authenticator (TOTP_SECRET in .env). Agents must ask the owner
    // for the current 6-digit code — no per-user secret/QR is ever issued.
    if (!verifyTotp(code, TOTP_SECRET)) return res.status(401).json({ error: 'invalid 2FA code' });
    setSessionCookie(res, signSession(user.email, user.role));
    res.json({ ok: true, email: user.email, role: user.role });
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    if (!isConfigured) return res.json({ email: 'dev', role: 'admin', configured: false });
    const sess = readSession(req);
    if (!sess) return res.status(401).json({ error: 'unauthorized' });
    res.json({ email: sess.sub, role: sess.role || 'admin', configured: true });
  });
}

// Middleware: admin-only routes (generate leads, settings/token, deletions).
// Agents get 403. In unconfigured dev mode everything is open.
function requireAdmin(req, res, next) {
  if (!isConfigured) return next();
  const sess = readSession(req);
  if (sess && sess.role === 'admin') return next();
  return res.status(403).json({ error: 'forbidden: admin only' });
}

module.exports = { mountRoutes, requireAuth, requireAdmin, isConfigured, COOKIE_NAME };
