const { getTournamentData, UserFacingError } = require('../lib/scrape');

let cache = new Map();
const CACHE_TTL_MS = 15000;

module.exports = async (req, res) => {
  const input = req.query.url;
  if (!input) {
    res.status(400).json({ error: 'Thiếu tham số url.' });
    return;
  }

  const cached = cache.get(input);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    res.status(200).json(cached.data);
    return;
  }

  try {
    const data = await getTournamentData(input);
    cache.set(input, { data, at: Date.now() });
    res.status(200).json(data);
  } catch (err) {
    if (err instanceof UserFacingError) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(502).json({ error: 'Không lấy được dữ liệu từ chess-results.com. Vui lòng thử lại sau.' });
  }
};
