import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { getTournamentData, getPlayerHistory, UserFacingError } from './lib/scrape.js';
import { logEvent, listEvents } from './lib/log.js';

if (process.env.VERCEL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // no local env file present; fine if Blob logging isn't configured locally
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '10kb' }));

const cache = new Map();
const playerCache = new Map();
const CACHE_TTL_MS = 15000;
const PLAYER_CACHE_TTL_MS = 60000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/tournament', async (req, res) => {
  const input = req.query.url;
  if (!input) {
    return res.status(400).json({ error: 'Thiếu tham số url.' });
  }

  const forceFresh = req.query.fresh === '1';
  const cached = cache.get(input);
  if (!forceFresh && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return res.json(cached.data);
  }

  try {
    const data = await getTournamentData(input);
    cache.set(input, { data, at: Date.now() });
    res.json(data);
  } catch (err) {
    if (err instanceof UserFacingError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    res.status(502).json({ error: 'Không lấy được dữ liệu từ chess-results.com. Vui lòng thử lại sau.' });
  }
});

app.get('/api/player', async (req, res) => {
  const { tnr, lan, fed, group, turdet, snr } = req.query;
  if (!tnr || !snr) {
    return res.status(400).json({ error: 'Thiếu tham số.' });
  }

  const key = [tnr, lan, fed, group, turdet, snr].join('|');
  const cached = playerCache.get(key);
  if (cached && Date.now() - cached.at < PLAYER_CACHE_TTL_MS) {
    return res.json(cached.data);
  }

  try {
    const data = await getPlayerHistory({ tnr, lan, fed, group, turdet, snr });
    playerCache.set(key, { data, at: Date.now() });
    res.json(data);
  } catch (err) {
    if (err instanceof UserFacingError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    res.status(502).json({ error: 'Không lấy được thông tin đấu thủ.' });
  }
});

const TRACK_EVENT_TYPES = new Set(['new_visitor', 'view_tournament', 'player_filter']);

app.post('/api/track-event', async (req, res) => {
  const body = req.body || {};
  if (!TRACK_EVENT_TYPES.has(body.type) || typeof body.visitorId !== 'string' || !body.visitorId) {
    return res.status(400).json({ error: 'Dữ liệu không hợp lệ.' });
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();

  logEvent(body.type, { ...body, ip }).catch(() => {});
  res.status(204).end();
});

app.get('/api/admin/events', async (req, res) => {
  if (!process.env.ADMIN_KEY || req.query.key !== process.env.ADMIN_KEY) {
    return res.status(404).send('Not found');
  }

  const events = await listEvents(300);

  if (req.query.format === 'json') {
    return res.json(events);
  }

  const rows = events
    .map((e) => {
      const detail =
        e.type === 'view_tournament'
          ? `${escapeHtml(e.tournamentName || '')} <span class="muted">(${escapeHtml(e.group || '')}, tnr${escapeHtml(e.tnr || '')})</span><br/><a href="${escapeHtml(e.url || '')}" target="_blank">${escapeHtml(e.url || '')}</a>`
          : e.type === 'player_filter'
          ? `Theo dõi: <b>${escapeHtml(e.playerName || '')}</b> <span class="muted">(tnr${escapeHtml(e.tnr || '')}/${escapeHtml(e.group || '')})</span>`
          : '';
      return `<tr><td>${escapeHtml(e.at || '')}</td><td>${escapeHtml(e.type || '')}</td><td>${escapeHtml((e.visitorId || '').slice(0, 8))}</td><td>${escapeHtml(e.ip || '')}</td><td>${detail}</td></tr>`;
    })
    .join('\n');

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Nhat ky su dung</title>
<style>
body{font-family:system-ui,sans-serif;background:#0f1420;color:#e7ecf7;padding:20px}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{padding:6px 10px;border-bottom:1px solid #2a3350;text-align:left;vertical-align:top}
th{background:#4f8cff;color:white;position:sticky;top:0}
.muted{color:#93a0bf}
a{color:#4f8cff}
</style></head>
<body>
<h2>Nhat ky su dung (${events.length} su kien gan nhat)</h2>
<table><thead><tr><th>Thoi gian</th><th>Loai</th><th>Visitor</th><th>IP</th><th>Chi tiet</th></tr></thead>
<tbody>${rows}</tbody></table>
</body></html>`);
});

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

if (process.env.VERCEL === undefined) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`chessresultnoti dang chay tai http://localhost:${PORT}`);
  });
}

export default app;
