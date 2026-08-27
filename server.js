const path = require('path');
const express = require('express');
const { getTournamentData, UserFacingError } = require('./lib/scrape');

const app = express();
const PORT = process.env.PORT || 3000;

const cache = new Map();
const CACHE_TTL_MS = 15000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/tournament', async (req, res) => {
  const input = req.query.url;
  if (!input) {
    return res.status(400).json({ error: 'Thiếu tham số url.' });
  }

  const cached = cache.get(input);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
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

app.listen(PORT, () => {
  console.log(`chessresultnoti dang chay tai http://localhost:${PORT}`);
});
