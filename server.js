import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { getTournamentData, getPlayerHistory, UserFacingError } from './lib/scrape.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

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

if (process.env.VERCEL === undefined) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`chessresultnoti dang chay tai http://localhost:${PORT}`);
  });
}

export default app;
