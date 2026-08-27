import { put, list, get } from '@vercel/blob';

const EVENTS_PREFIX = 'events/';

function blobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function clip(s, max) {
  if (typeof s !== 'string') return '';
  return s.slice(0, max);
}

async function logEvent(type, payload) {
  if (!blobConfigured()) return;
  try {
    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    const key = `${EVENTS_PREFIX}${id}.json`;
    const body = JSON.stringify({
      type,
      at: new Date().toISOString(),
      visitorId: clip(payload.visitorId, 100),
      tnr: clip(payload.tnr, 30),
      group: clip(payload.group, 30),
      tournamentName: clip(payload.tournamentName, 300),
      url: clip(payload.url, 500),
      playerName: clip(payload.playerName, 200),
      ip: clip(payload.ip, 100),
    });
    await put(key, body, {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
    });
  } catch (err) {
    console.error('logEvent failed:', err);
  }
}

async function listEvents(limit = 300) {
  if (!blobConfigured()) return [];
  const { blobs } = await list({ prefix: EVENTS_PREFIX, limit: 1000 });
  const sorted = blobs
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
    .slice(0, limit);

  const events = await Promise.all(
    sorted.map(async (b) => {
      try {
        const res = await get(b.url, { access: 'private' });
        if (!res) return null;
        const chunks = [];
        for await (const chunk of res.stream) chunks.push(chunk);
        const text = Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))).toString('utf-8');
        return JSON.parse(text);
      } catch (err) {
        return null;
      }
    })
  );

  return events.filter(Boolean);
}

export { logEvent, listEvents };
