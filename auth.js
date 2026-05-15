const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const otp    = require('otplib');

const COOKIE_NAME  = 'lh_session';
const TOKEN_TTL    = '24h';
const COOKIE_MAXMS = 24 * 60 * 60 * 1000;

const ADMIN_EMAIL   = process.env.ADMIN_EMAIL   || '';
const PASSWORD_HASH = process.env.PASSWORD_HASH || '';
const TOTP_SECRET   = process.env.TOTP_SECRET   || '';
const JWT_SECRET    = process.env.JWT_SECRET    || '';

const isConfigured = !!(ADMIN_EMAIL && PASSWORD_HASH && TOTP_SECRET && JWT_SECRET);
const IS_PROD = process.env.NODE_ENV === 'production';
if (!isConfigured) {
  if (IS_PROD) {
    console.error('[auth] FATAL: missing one of ADMIN_EMAIL / PASSWORD_HASH / TOTP_SECRET / JWT_SECRET in production. Refusing all requests.');
  } else {
    console.warn('[auth] Missing one of ADMIN_EMAIL / PASSWORD_HASH / TOTP_SECRET / JWT_SECRET — auth is OPEN (dev only).');
  }
}

function verifyTotp(code) {
  if (!code) return false;
  return otp.verify({ token: String(code).replace(/\s+/g,''), secret: TOTP_SECRET, encoding: 'base32', window: 1 });
}

function signSession(email) {
  return jwt.sign({ sub: email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
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
    if (email.trim().toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      return res.status(401).json({ error: 'invalid credentials' });
    }
    const passOk = await bcrypt.compare(password, PASSWORD_HASH);
    if (!passOk) return res.status(401).json({ error: 'invalid credentials' });
    if (!verifyTotp(code)) return res.status(401).json({ error: 'invalid 2FA code' });
    setSessionCookie(res, signSession(ADMIN_EMAIL));
    res.json({ ok: true, email: ADMIN_EMAIL });
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    if (!isConfigured) return res.json({ email: 'dev', configured: false });
    const sess = readSession(req);
    if (!sess) return res.status(401).json({ error: 'unauthorized' });
    res.json({ email: sess.sub, configured: true });
  });
}

module.exports = { mountRoutes, requireAuth, isConfigured, COOKIE_NAME };
