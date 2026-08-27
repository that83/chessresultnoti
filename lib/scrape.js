import * as cheerio from 'cheerio';
import crypto from 'crypto';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) chessresultnoti/1.0';
const FETCH_TIMEOUT_MS = 15000;

class UserFacingError extends Error {}

function parseInput(rawInput) {
  const trimmed = (rawInput || '').trim();
  if (!trimmed) throw new UserFacingError('Vui lòng nhập URL của giải đấu.');

  let url;
  try {
    url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    throw new UserFacingError('URL không hợp lệ.');
  }

  if (!/(^|\.)chess-results\.com$/i.test(url.hostname)) {
    throw new UserFacingError('Chỉ hỗ trợ URL từ chess-results.com.');
  }

  const tnrMatch = url.pathname.match(/tnr(\d+)/i);
  if (!tnrMatch) {
    throw new UserFacingError('Không tìm thấy mã giải đấu (tnr...) trong URL.');
  }

  const tnr = tnrMatch[1];
  const lan = url.searchParams.get('lan') || '29';
  const fed = url.searchParams.get('fed') || '';
  const group = url.searchParams.get('group') || '';
  const turdet = url.searchParams.get('turdet') || 'YES';

  return { tnr, lan, fed, group, turdet };
}

function buildUrl({ tnr, lan, fed, group, turdet }, extra = {}) {
  const params = new URLSearchParams();
  params.set('lan', lan);
  if (extra.art !== undefined) params.set('art', extra.art);
  if (extra.rd !== undefined) params.set('rd', extra.rd);
  if (fed) params.set('fed', fed);
  if (turdet) params.set('turdet', turdet);
  if (group) params.set('group', group);
  return `https://chess-results.com/tnr${tnr}.aspx?${params.toString()}`;
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'vi,en;q=0.8' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new UserFacingError(`Không tải được trang giải đấu (HTTP ${res.status}).`);
    }
    const buf = await res.arrayBuffer();
    return Buffer.from(buf).toString('utf-8');
  } finally {
    clearTimeout(timer);
  }
}

function cleanText(s) {
  return (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

function parseTable($, table) {
  if (!table || table.length === 0) return null;
  const rows = table.find('> tbody > tr, > tr');
  if (rows.length === 0) return null;

  const headerCells = rows.eq(0).find('th, td');
  const headers = headerCells.map((i, el) => cleanText($(el).text())).get();

  const dataRows = [];
  rows.slice(1).each((i, tr) => {
    const cells = $(tr).find('td');
    if (cells.length === 0) return;
    const values = cells.map((j, el) => cleanText($(el).text())).get();
    dataRows.push(values);
  });

  return { headers, rows: dataRows };
}

function parseNav($, html) {
  const standingsRounds = [];
  $('a[href*="art=1"][href*="rd="]').each((i, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/[?&]rd=(\d+)/);
    if (m) standingsRounds.push(parseInt(m[1], 10));
  });

  const pairingRounds = [];
  $('a[href*="art=2"][href*="rd="]').each((i, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/[?&]rd=(\d+)/);
    if (m) pairingRounds.push(parseInt(m[1], 10));
  });

  const maxStandingsRound = standingsRounds.length ? Math.max(...standingsRounds) : null;

  const currentMatch = html.match(/V(\d+)\s*\/\s*(\d+)/);
  let currentPairingRound = null;
  let totalRounds = null;
  let pairingIsFinal = false;

  if (currentMatch) {
    currentPairingRound = parseInt(currentMatch[1], 10);
    totalRounds = parseInt(currentMatch[2], 10);
  } else if (pairingRounds.length) {
    currentPairingRound = Math.max(...pairingRounds);
    totalRounds = currentPairingRound;
    pairingIsFinal = true;
  }

  return { maxStandingsRound, currentPairingRound, totalRounds, pairingIsFinal };
}

async function getTournamentData(rawInput) {
  const params = parseInput(rawInput);

  const baseUrl = buildUrl(params, { art: 0 });
  const baseHtml = await fetchHtml(baseUrl);
  const $base = cheerio.load(baseHtml);

  const tournamentName = cleanText($base('h2').first().text());
  const startingListTitle = cleanText($base('h2').eq(1).text());
  const startingList = parseTable($base, $base('table.CRs1').first());

  if (!tournamentName && !startingList) {
    throw new UserFacingError('Không tìm thấy giải đấu này trên chess-results.com. Vui lòng kiểm tra lại URL.');
  }

  const nav = parseNav($base, baseHtml);

  let standings = null;
  if (nav.maxStandingsRound) {
    const url = buildUrl(params, { art: 1, rd: nav.maxStandingsRound });
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    standings = {
      round: nav.maxStandingsRound,
      totalRounds: nav.totalRounds,
      isFinal: nav.totalRounds ? nav.maxStandingsRound >= nav.totalRounds : false,
      title: cleanText($('h2').eq(1).text()),
      table: parseTable($, $('table.CRs1').first()),
    };
  }

  let pairings = null;
  if (nav.currentPairingRound) {
    const url = buildUrl(params, { art: 2, rd: nav.currentPairingRound });
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    pairings = {
      round: nav.currentPairingRound,
      totalRounds: nav.totalRounds,
      isFinal: nav.pairingIsFinal,
      title: cleanText($('h2').eq(1).text()),
      table: parseTable($, $('table.CRs1').first()),
    };
  }

  const hashSource = JSON.stringify({ standings, pairings });
  const hash = crypto.createHash('sha1').update(hashSource).digest('hex');

  return {
    meta: {
      tnr: params.tnr,
      lan: params.lan,
      fed: params.fed,
      group: params.group,
      turdet: params.turdet,
      tournamentName,
      sourceUrl: baseUrl,
      fetchedAt: new Date().toISOString(),
    },
    startingList: startingList ? { title: startingListTitle, table: startingList } : null,
    standings,
    pairings,
    hash,
  };
}

export { getTournamentData, parseInput, UserFacingError };
