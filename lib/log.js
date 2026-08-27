import { put, list, get } from '@vercel/blob';

const VISITORS_PREFIX = 'visitors/';
const MAX_ITEMS_PER_VISITOR = 20;

function blobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function clip(s, max) {
  if (typeof s !== 'string') return '';
  return s.slice(0, max);
}

async function readJsonBlob(url) {
  const res = await get(url, { access: 'private' });
  if (!res) return null;
  const chunks = [];
  for await (const chunk of res.stream) chunks.push(chunk);
  const text = Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))).toString('utf-8');
  return JSON.parse(text);
}

function upsertByKey(list_, keyFn, entry) {
  const key = keyFn(entry);
  const filtered = (list_ || []).filter((x) => keyFn(x) !== key);
  filtered.unshift(entry);
  return filtered.slice(0, MAX_ITEMS_PER_VISITOR);
}

async function logEvent(type, payload) {
  if (!blobConfigured()) return;
  const visitorId = clip(payload.visitorId, 100);
  if (!visitorId) return;

  try {
    const pathname = `${VISITORS_PREFIX}${visitorId}.json`;
    let record = null;
    try {
      record = await readJsonBlob(pathname);
    } catch {
      record = null;
    }

    const now = new Date().toISOString();
    if (!record) {
      record = { visitorId, firstSeen: now, lastSeen: now, ip: '', tournaments: [], playerNames: [] };
    }
    record.lastSeen = now;
    const ip = clip(payload.ip, 100);
    if (ip) record.ip = ip;

    if (type === 'view_tournament') {
      const entry = {
        tnr: clip(payload.tnr, 30),
        group: clip(payload.group, 30),
        tournamentName: clip(payload.tournamentName, 300),
        url: clip(payload.url, 500),
        at: now,
      };
      record.tournaments = upsertByKey(record.tournaments, (x) => x.tnr + '|' + x.group, entry);
    } else if (type === 'player_filter') {
      const name = clip(payload.playerName, 200);
      if (name) {
        const entry = { name, tnr: clip(payload.tnr, 30), group: clip(payload.group, 30), at: now };
        record.playerNames = upsertByKey(record.playerNames, (x) => x.name.toLowerCase(), entry);
      }
    }

    await put(pathname, JSON.stringify(record), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  } catch (err) {
    console.error('logEvent failed:', err);
  }
}

async function listVisitors(limit = 200) {
  if (!blobConfigured()) return [];
  const { blobs } = await list({ prefix: VISITORS_PREFIX, limit: 1000 });
  const sorted = blobs
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
    .slice(0, limit);

  const records = await Promise.all(
    sorted.map(async (b) => {
      try {
        return await readJsonBlob(b.url);
      } catch {
        return null;
      }
    })
  );

  return records.filter(Boolean).sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
}

export { logEvent, listVisitors };
