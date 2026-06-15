require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const https = require('https');
const XLSX = require('xlsx');
const auth = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'Data');
const ENV_FILE = path.join(__dirname, '.env');
const PUBLIC_DIR = path.join(__dirname, 'public');

app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

// Public auth routes (no auth required)
auth.mountRoutes(app);

// Login page is public
app.get('/login', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.html')));

// Everything else requires a valid session
app.use(auth.requireAuth);
app.use(express.static(PUBLIC_DIR));

[DATA_DIR, PUBLIC_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ── HTTP helpers ──────────────────────────────────────────────────────────
function httpsRequest(method, urlStr, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: { 'Content-Type': 'application/json', ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}) }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Middleware: block access to a menu (folder) the current user isn't scoped to.
function menuGuard(req, res, next) {
  if (auth.canAccessMenu(req, req.params.cat)) return next();
  return res.status(403).json({ error: 'forbidden: no access to this menu' });
}

// ── File helpers ──────────────────────────────────────────────────────────
function safePath(...parts) {
  const p = path.resolve(DATA_DIR, ...parts);
  if (!p.startsWith(DATA_DIR)) throw new Error('Invalid path');
  return p;
}

function readSession(cat, file) {
  try { return JSON.parse(fs.readFileSync(safePath(cat, file), 'utf8')); } catch { return null; }
}

function writeSession(cat, file, data) {
  const dir = safePath(cat);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), JSON.stringify(data, null, 2), 'utf8');
}

function syncMeta(data) {
  const l = data.leads || [];
  Object.assign(data.meta, {
    totalResults: l.length,
    withPhone: l.filter(x => x.phone).length,
    withWebsite: l.filter(x => x.website).length,
    withEmail: l.filter(x => x.email).length
  });
}

function normalizeLead(l, fallbackCategory) {
  return {
    name: l.name || l.title || '',
    category: l.category || l.categoryName || fallbackCategory || '',
    address: l.address || '',
    phone: l.phone || null,
    website: l.website || null,
    email: l.email || null,
    rating: l.rating || l.totalScore || null,
    reviewsCount: l.reviewsCount || 0,
    googleMapsUrl: l.googleMapsUrl || l.url || null,
    status: l.status || 'new',
    notes: l.notes || '',
    followUpDate: l.followUpDate || null,
    lastContactedAt: l.lastContactedAt || null
  };
}

function buildCsv(leads) {
  const h = ['Name','Category','Address','Phone','Website','Email','Rating','Reviews','Google Maps','Status','Notes','Follow-up Date','Last Contacted'];
  const rows = leads.map(l => [
    l.name, l.category, l.address, l.phone, l.website, l.email,
    l.rating, l.reviewsCount, l.googleMapsUrl, l.status, l.notes, l.followUpDate, l.lastContactedAt
  ].map(v => `"${(v ?? '').toString().replace(/"/g, '""')}"`).join(','));
  return [h.join(','), ...rows].join('\n');
}

// Write the CSV + XLSX siblings for a session JSON file. Best-effort.
function writeExports(catFolder, jsonFilename, leads) {
  try {
    fs.writeFileSync(safePath(catFolder, jsonFilename.replace('.json', '.csv')), buildCsv(leads), 'utf8');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(leads.map(l => ({
      Name: l.name, Category: l.category, Address: l.address, Phone: l.phone,
      Website: l.website, Email: l.email, Rating: l.rating, Reviews: l.reviewsCount,
      'Google Maps': l.googleMapsUrl, Status: l.status, Notes: l.notes
    }))), 'Leads');
    XLSX.writeFile(wb, safePath(catFolder, jsonFilename.replace('.json', '.xlsx')));
  } catch (e) {
    console.error('[EXPORT] CSV/XLSX write failed:', e.message);
  }
}

// Identity key for de-duplicating a lead across pulls: prefer the Google Maps
// place URL (stable place id), else name + address (case-insensitive).
function leadKey(l) {
  return (l.googleMapsUrl || `${(l.name || '').trim().toLowerCase()}|${(l.address || '').trim().toLowerCase()}`);
}

// Find the most-recent existing session in a menu whose city matches (so a
// re-pull of the same location merges into it instead of duplicating).
function findCitySession(catFolder, city) {
  const dir = safePath(catFolder);
  if (!fs.existsSync(dir)) return null;
  const want = String(city || '').trim().toLowerCase();
  if (!want) return null;
  let best = null;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (String(data.meta?.city || '').trim().toLowerCase() !== want) continue;
      if (!best || (data.meta?.fetchedAt || '') > (best.data.meta?.fetchedAt || '')) best = { filename: f, data };
    } catch {}
  }
  return best;
}

// ── Token ─────────────────────────────────────────────────────────────────
app.get('/api/token', auth.requireAdmin, (req, res) => {
  res.json({ token: process.env.APIFY_TOKEN || '' });
});

app.post('/api/token', auth.requireAdmin, (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'No token provided' });
  let env = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  env = env.includes('APIFY_TOKEN=')
    ? env.replace(/APIFY_TOKEN=.*/g, `APIFY_TOKEN=${token}`)
    : env + `\nAPIFY_TOKEN=${token}`;
  fs.writeFileSync(ENV_FILE, env.trim() + '\n', 'utf8');
  process.env.APIFY_TOKEN = token;
  res.json({ ok: true });
});

// ── Sessions list ─────────────────────────────────────────────────────────
app.get('/api/sessions', (req, res) => {
  const sessions = [];
  if (!fs.existsSync(DATA_DIR)) return res.json([]);
  for (const cat of fs.readdirSync(DATA_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)) {
    if (!auth.canAccessMenu(req, cat)) continue;
    const catPath = path.join(DATA_DIR, cat);
    for (const file of fs.readdirSync(catPath).filter(f => f.endsWith('.json'))) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(catPath, file), 'utf8'));
        if (data.meta) sessions.push({ category: cat, filename: file, meta: data.meta });
      } catch {}
    }
  }
  sessions.sort((a, b) => (b.meta.fetchedAt || '').localeCompare(a.meta.fetchedAt || ''));
  res.json(sessions);
});

// ── Menus (categories) ──────────────────────────────────────────────────────
// A "menu" is a top-level folder; each session file inside it is a sub-item.
app.get('/api/categories', (req, res) => {
  const cats = [];
  if (fs.existsSync(DATA_DIR)) {
    for (const d of fs.readdirSync(DATA_DIR, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      if (!auth.canAccessMenu(req, d.name)) continue;
      const files = fs.readdirSync(path.join(DATA_DIR, d.name)).filter(f => f.endsWith('.json'));
      let leads = 0;
      for (const f of files) {
        try { leads += (JSON.parse(fs.readFileSync(path.join(DATA_DIR, d.name, f), 'utf8')).leads || []).length; } catch {}
      }
      cats.push({ folder: d.name, name: d.name.replace(/ Leads$/, ''), sessions: files.length, leads });
    }
  }
  cats.sort((a, b) => a.name.localeCompare(b.name));
  res.json(cats);
});

// Rename a menu. If the target name already exists, the two menus MERGE
// (sessions moved in, colliding filenames suffixed). Admin only.
app.post('/api/categories/rename', auth.requireAdmin, (req, res) => {
  try {
    const fromFolder = String(req.body.from || '').trim();
    const toName = String(req.body.to || '').trim().replace(/ Leads$/, '');
    if (!fromFolder || !toName) return res.status(400).json({ error: 'from and to required' });
    const src = safePath(fromFolder);
    if (!fs.existsSync(src)) return res.status(404).json({ error: 'menu not found' });
    const toFolder = toName + ' Leads';
    const dst = safePath(toFolder);
    if (path.resolve(src) === path.resolve(dst)) return res.json({ ok: true, folder: toFolder });

    const merged = fs.existsSync(dst);
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) {
      let target = path.join(dst, f);
      if (fs.existsSync(target)) {
        const ext = path.extname(f), base = path.basename(f, ext);
        target = path.join(dst, `${base}_${Date.now().toString(36)}${ext}`);
      }
      if (f.endsWith('.json')) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(src, f), 'utf8'));
          if (data.meta) data.meta.category = toName;
          fs.writeFileSync(target, JSON.stringify(data, null, 2), 'utf8');
          fs.unlinkSync(path.join(src, f));
          continue;
        } catch {}
      }
      fs.renameSync(path.join(src, f), target);
    }
    try { fs.rmdirSync(src); } catch {}
    auth.updateMenuInAccess(fromFolder, toName);
    res.json({ ok: true, folder: toFolder, merged });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete a whole menu (folder) and all its sessions. Admin only.
app.delete('/api/categories/:folder', auth.requireAdmin, (req, res) => {
  try {
    const dir = safePath(req.params.folder);
    if (path.resolve(dir) === path.resolve(DATA_DIR)) return res.status(400).json({ error: 'invalid' });
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'menu not found' });
    fs.rmSync(dir, { recursive: true, force: true });
    auth.updateMenuInAccess(req.params.folder, null);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Single session ────────────────────────────────────────────────────────
app.get('/api/sessions/:cat/:file', menuGuard, (req, res) => {
  const data = readSession(req.params.cat, req.params.file);
  if (!data) return res.status(404).json({ error: 'Not found' });
  // Normalize leads (adds missing fields for old format files)
  data.leads = (data.leads || []).map(l => normalizeLead(l, data.meta?.category));
  res.json(data);
});

app.delete('/api/sessions/:cat/:file', auth.requireAdmin, (req, res) => {
  try {
    const base = req.params.file.replace(/\.json$/, '');
    for (const ext of ['.json', '.csv', '.xlsx']) {
      try { fs.unlinkSync(safePath(req.params.cat, base + ext)); } catch {}
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Leads CRUD ────────────────────────────────────────────────────────────
app.patch('/api/sessions/:cat/:file/leads/:idx', menuGuard, (req, res) => {
  const data = readSession(req.params.cat, req.params.file);
  if (!data) return res.status(404).json({ error: 'Session not found' });
  const idx = parseInt(req.params.idx);
  if (isNaN(idx) || idx < 0 || idx >= data.leads.length) return res.status(400).json({ error: 'Invalid index' });
  Object.assign(data.leads[idx], req.body);
  syncMeta(data);
  writeSession(req.params.cat, req.params.file, data);
  res.json(data.leads[idx]);
});

app.post('/api/sessions/:cat/:file/leads', auth.requireAdmin, (req, res) => {
  const data = readSession(req.params.cat, req.params.file);
  if (!data) return res.status(404).json({ error: 'Session not found' });
  const lead = normalizeLead(req.body, data.meta?.category);
  data.leads.push(lead);
  syncMeta(data);
  writeSession(req.params.cat, req.params.file, data);
  res.json({ idx: data.leads.length - 1, lead });
});

app.delete('/api/sessions/:cat/:file/leads/:idx', auth.requireAdmin, (req, res) => {
  const data = readSession(req.params.cat, req.params.file);
  if (!data) return res.status(404).json({ error: 'Session not found' });
  const idx = parseInt(req.params.idx);
  if (isNaN(idx) || idx < 0 || idx >= data.leads.length) return res.status(400).json({ error: 'Invalid index' });
  data.leads.splice(idx, 1);
  syncMeta(data);
  writeSession(req.params.cat, req.params.file, data);
  res.json({ ok: true });
});

// ── Save generated session ─────────────────────────────────────────────────
app.post('/api/sessions', auth.requireAdmin, (req, res) => {
  try {
    const { category, city, keywords, leads: rawLeads } = req.body;
    console.log(`[SAVE SESSION] category=${category} city=${city} leads=${rawLeads?.length || 0}`);
    if (!rawLeads?.length) return res.status(400).json({ error: 'No leads' });

    const ts = new Date().toISOString().slice(0, 10) + '_' + new Date().toTimeString().slice(0, 5).replace(':', '');
    const catFolder = (category || 'Other').trim() + ' Leads';
    const leads = rawLeads.map(l => normalizeLead(l, category));

    // ── Smart merge: if this menu already has this location, merge into it ──
    const existing = findCitySession(catFolder, city);
    if (existing) {
      const data = existing.data;
      data.leads = data.leads || [];
      const seen = new Map(data.leads.map(l => [leadKey(l), l]));
      // Only these fields are safe to backfill on an existing lead — never
      // touch status / notes / followUpDate / lastContactedAt.
      const ENRICH = ['phone', 'website', 'email', 'googleMapsUrl', 'address'];
      let added = 0, enriched = 0;
      for (const nl of leads) {
        const k = leadKey(nl);
        const cur = seen.get(k);
        if (!cur) {
          data.leads.push(nl);
          seen.set(k, nl);
          added++;
        } else {
          let touched = false;
          for (const f of ENRICH) {
            const empty = cur[f] === null || cur[f] === undefined || cur[f] === '';
            const has = nl[f] !== null && nl[f] !== undefined && nl[f] !== '';
            if (empty && has) { cur[f] = nl[f]; touched = true; }
          }
          if (touched) enriched++;
        }
      }
      data.meta = data.meta || {};
      data.meta.keywords = [...new Set([...(data.meta.keywords || []), ...(keywords || [])])];
      data.meta.lastFetchedAt = new Date().toISOString();
      syncMeta(data);

      writeSession(catFolder, existing.filename, data);
      writeExports(catFolder, existing.filename, data.leads);
      const skipped = leads.length - added;
      console.log(`[SAVE SESSION] ✓ Merged into ${catFolder}/${existing.filename} (+${added} new, ${skipped} existing, ${enriched} enriched)`);
      return res.json({
        category: catFolder, filename: existing.filename, meta: data.meta,
        merged: true, added, skipped, enriched, total: data.leads.length
      });
    }

    // ── Otherwise create a fresh location session ──
    const filename = `${(city || 'all').replace(/\s+/g, '-')}_${ts}.json`;
    const data = {
      meta: {
        tool: 'LeadHunter',
        searchQuery: keywords?.length ? keywords.join(' + ') + ` in ${city}` : `${category} in ${city}`,
        category,
        city,
        keywords: keywords || [category],
        fetchedAt: new Date().toISOString(),
        totalResults: leads.length,
        withPhone: leads.filter(l => l.phone).length,
        withWebsite: leads.filter(l => l.website).length,
        withEmail: leads.filter(l => l.email).length
      },
      leads
    };

    writeSession(catFolder, filename, data);
    writeExports(catFolder, filename, data.leads);
    console.log(`[SAVE SESSION] ✓ Wrote ${catFolder}/${filename}`);

    res.json({ category: catFolder, filename, meta: data.meta, merged: false, added: leads.length, total: leads.length });
  } catch (e) {
    console.error('[SAVE SESSION] FAILED:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Apify proxy ────────────────────────────────────────────────────────────
app.post('/api/apify/run', auth.requireAdmin, async (req, res) => {
  const token = process.env.APIFY_TOKEN;
  if (!token) return res.status(400).json({ error: 'No Apify token. Go to Settings and add your token.' });
  try {
    const r = await httpsRequest('POST', `https://api.apify.com/v2/acts/compass~crawler-google-places/runs?token=${encodeURIComponent(token)}`, req.body);
    res.status(r.status).json(r.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/apify/run/:runId', auth.requireAdmin, async (req, res) => {
  const token = process.env.APIFY_TOKEN;
  if (!token) return res.status(400).json({ error: 'No token' });
  try {
    const r = await httpsRequest('GET', `https://api.apify.com/v2/actor-runs/${req.params.runId}?token=${encodeURIComponent(token)}`);
    res.status(r.status).json(r.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/apify/run/:runId/results', auth.requireAdmin, async (req, res) => {
  const token = process.env.APIFY_TOKEN;
  if (!token) return res.status(400).json({ error: 'No token' });
  try {
    const r = await httpsRequest('GET', `https://api.apify.com/v2/actor-runs/${req.params.runId}/dataset/items?token=${encodeURIComponent(token)}&format=json`);
    res.status(r.status).json(r.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Export ─────────────────────────────────────────────────────────────────
app.get('/api/export/:cat/:file/csv', menuGuard, (req, res) => {
  const data = readSession(req.params.cat, req.params.file);
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.file.replace('.json', '.csv')}"`);
  res.send(buildCsv((data.leads || []).map(l => normalizeLead(l, data.meta?.category))));
});

app.get('/api/export/:cat/:file/xlsx', menuGuard, (req, res) => {
  const data = readSession(req.params.cat, req.params.file);
  if (!data) return res.status(404).json({ error: 'Not found' });
  const leads = (data.leads || []).map(l => normalizeLead(l, data.meta?.category));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(leads.map(l => ({
    Name: l.name, Category: l.category, Address: l.address, Phone: l.phone,
    Website: l.website, Email: l.email, Rating: l.rating, Reviews: l.reviewsCount,
    'Google Maps': l.googleMapsUrl, Status: l.status, Notes: l.notes,
    'Follow-up Date': l.followUpDate, 'Last Contacted': l.lastContactedAt
  })));
  ws['!cols'] = [{wch:30},{wch:20},{wch:40},{wch:18},{wch:30},{wch:30},{wch:8},{wch:8},{wch:50},{wch:14},{wch:40},{wch:14},{wch:14}];
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.file.replace('.json', '.xlsx')}"`);
  res.send(buf);
});

// ── Copy phones list ───────────────────────────────────────────────────────
app.get('/api/export/:cat/:file/phones', menuGuard, (req, res) => {
  const data = readSession(req.params.cat, req.params.file);
  if (!data) return res.status(404).json({ error: 'Not found' });
  const phones = (data.leads || []).map(l => l.phone).filter(Boolean);
  res.json({ phones });
});

// ── Notes API ──────────────────────────────────────────────────────────────
const NOTES_FILE = path.join(DATA_DIR, 'notes.json');

function readNotes() {
  try { return JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8')).notes || []; }
  catch { return []; }
}

function writeNotes(notes) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(NOTES_FILE, JSON.stringify({ notes }, null, 2), 'utf8');
}

app.get('/api/notes', (req, res) => {
  res.json(readNotes());
});

app.post('/api/notes', (req, res) => {
  const notes = readNotes();
  const note = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    title: req.body.title || 'Untitled',
    content: req.body.content || '',
    color: req.body.color || 'green',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  notes.unshift(note);
  writeNotes(notes);
  res.json(note);
});

app.patch('/api/notes/:id', (req, res) => {
  const notes = readNotes();
  const i = notes.findIndex(n => n.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Note not found' });
  Object.assign(notes[i], req.body, { updatedAt: new Date().toISOString() });
  writeNotes(notes);
  res.json(notes[i]);
});

app.delete('/api/notes/:id', (req, res) => {
  const notes = readNotes().filter(n => n.id !== req.params.id);
  writeNotes(notes);
  res.json({ ok: true });
});

// Global error logger
app.use((err, req, res, _next) => {
  console.error(`[ERROR] ${req.method} ${req.url}:`, err.message);
  res.status(500).json({ error: err.message });
});

process.on('uncaughtException', err => console.error('[UNCAUGHT]', err));
process.on('unhandledRejection', err => console.error('[UNHANDLED]', err));

app.listen(PORT, () => {
  console.log(`\n  LeadHunter CRM  →  http://localhost:${PORT}\n`);
  if (!process.env.APIFY_TOKEN) {
    console.log('  ⚠  No APIFY_TOKEN found in .env — add it via Settings in the UI\n');
  }
});
