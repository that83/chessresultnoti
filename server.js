import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { getTournamentData, getPlayerHistory, getRoundPairings, UserFacingError } from './lib/scrape.js';
import { logEvent, listVisitors } from './lib/log.js';

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
const roundCache = new Map();
const CACHE_TTL_MS = 15000;
const PLAYER_CACHE_TTL_MS = 60000;
const ROUND_CACHE_TTL_MS = 300000;

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

app.get('/api/round', async (req, res) => {
  const { tnr, lan, fed, group, turdet, rd } = req.query;
  if (!tnr || !rd) {
    return res.status(400).json({ error: 'Thiếu tham số.' });
  }

  const key = [tnr, lan, fed, group, turdet, rd].join('|');
  const cached = roundCache.get(key);
  if (cached && Date.now() - cached.at < ROUND_CACHE_TTL_MS) {
    return res.json(cached.data);
  }

  try {
    const data = await getRoundPairings({ tnr, lan, fed, group, turdet, rd });
    roundCache.set(key, { data, at: Date.now() });
    res.json(data);
  } catch (err) {
    if (err instanceof UserFacingError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    res.status(502).json({ error: 'Không lấy được dữ liệu ván đấu.' });
  }
});

const TRACK_EVENT_TYPES = new Set(['new_visitor', 'view_tournament', 'player_filter']);

app.post('/api/track-event', async (req, res) => {
  const body = req.body || {};
  if (!TRACK_EVENT_TYPES.has(body.type) || typeof body.visitorId !== 'string' || !body.visitorId) {
    return res.status(400).json({ error: 'Dữ liệu không hợp lệ.' });
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();

  // Must await: on serverless, work left running after the response is
  // sent can be frozen/killed before it completes (most likely to bite
  // events fired right as the tab is closing, e.g. player_filter).
  await logEvent(body.type, { ...body, ip });
  res.status(204).end();
});

app.get('/api/admin/events', async (req, res) => {
  if (!process.env.ADMIN_KEY || req.query.key !== process.env.ADMIN_KEY) {
    return res.status(404).send('Not found');
  }

  const visitors = await listVisitors(200);

  if (req.query.format === 'json') {
    return res.json(visitors);
  }

  const rows = visitors
    .map((v) => {
      const tournamentsHtml =
        (v.tournaments || [])
          .map(
            (t) =>
              `<div>${escapeHtml(t.tournamentName || '')} <span class="muted">(${escapeHtml(t.group || '')}, tnr${escapeHtml(t.tnr || '')}, ${escapeHtml(shortTime(t.at))})</span><br/><a href="${escapeHtml(t.url || '')}" target="_blank">${escapeHtml(t.url || '')}</a></div>`
          )
          .join('<hr style="border-color:#2a3350;margin:6px 0">') || '<span class="muted">-</span>';
      const namesHtml =
        (v.playerNames || [])
          .map((p) => `<span class="chip">${escapeHtml(p.name)}</span>`)
          .join(' ') || '<span class="muted">-</span>';
      return `<tr>
        <td>${escapeHtml(shortTime(v.firstSeen))}</td>
        <td>${escapeHtml(shortTime(v.lastSeen))}</td>
        <td>${escapeHtml((v.visitorId || '').slice(0, 8))}</td>
        <td>${escapeHtml(v.ip || '')}</td>
        <td>${tournamentsHtml}</td>
        <td>${namesHtml}</td>
      </tr>`;
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
.chip{display:inline-block;background:#1c2338;border:1px solid #2a3350;border-radius:999px;padding:2px 8px;margin:2px 4px 2px 0}
</style></head>
<body>
<h2>Nhat ky su dung (${visitors.length} nguoi da dung)</h2>
<table><thead><tr><th>Lan dau</th><th>Lan cuoi</th><th>Visitor</th><th>IP</th><th>Giai da xem</th><th>Ten da tim</th></tr></thead>
<tbody>${rows}</tbody></table>
</body></html>`);
});

function shortTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('vi-VN');
  } catch {
    return iso;
  }
}

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
