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
  // Always Vietnamese: every column-header and round-marker match in this
  // scraper is written against the Vietnamese strings chess-results.com
  // renders for lan=29. Any other lan value returns different text (e.g.
  // "Name"/"FideID"/"Rd" for lan=1) and silently breaks every lookup.
  const lan = '29';
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
    const html = Buffer.from(buf).toString('utf-8');

    // chess-results.com hides the results/pairings nav for tournaments more
    // than ~2 weeks past their end date (stated reason: reduce load from
    // search-engine crawlers), showing only the starting list behind a
    // "Xem thông tin" button instead. A real browser reveals it by
    // submitting that button's ASP.NET postback; replicate it here so old
    // tournaments work the same as recent ones.
    if (html.includes('id="cb_alleDetails"')) {
      return await revealHiddenDetails(res.url, html, res.headers.get('set-cookie'));
    }
    return html;
  } finally {
    clearTimeout(timer);
  }
}

async function revealHiddenDetails(pageUrl, fallbackHtml, setCookieHeader) {
  const vsMatch = fallbackHtml.match(/id="__VIEWSTATE" value="([^"]*)"/);
  const evMatch = fallbackHtml.match(/id="__EVENTVALIDATION" value="([^"]*)"/);
  if (!vsMatch || !evMatch) return fallbackHtml;
  const vsgMatch = fallbackHtml.match(/id="__VIEWSTATEGENERATOR" value="([^"]*)"/);

  const body = new URLSearchParams();
  body.set('__EVENTTARGET', '');
  body.set('__EVENTARGUMENT', '');
  body.set('__VIEWSTATE', vsMatch[1]);
  if (vsgMatch) body.set('__VIEWSTATEGENERATOR', vsgMatch[1]);
  body.set('__EVENTVALIDATION', evMatch[1]);
  body.set('cb_alleDetails', 'Xem thông tin');

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'User-Agent': UA,
  };
  if (setCookieHeader) {
    headers.Cookie = setCookieHeader.split(';')[0];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(pageUrl, {
      method: 'POST',
      headers,
      body: body.toString(),
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) return fallbackHtml;
    const buf = await res.arrayBuffer();
    return Buffer.from(buf).toString('utf-8');
  } catch {
    return fallbackHtml;
  } finally {
    clearTimeout(timer);
  }
}

function cleanText(s) {
  return (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

function parseCell($, el) {
  const $el = $(el);
  const text = cleanText($el.text());
  const link = $el.find('a[href*="art=9"][href*="snr="]').first();
  if (link.length) {
    const href = link.attr('href') || '';
    const snrMatch = href.match(/[?&]snr=(\d+)/);
    const fedMatch = href.match(/[?&]fed=([^&]+)/);
    if (snrMatch) {
      return { text, snr: parseInt(snrMatch[1], 10), fed: fedMatch ? decodeURIComponent(fedMatch[1]) : null };
    }
  }
  return { text };
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
    const values = cells.map((j, el) => parseCell($, el)).get();
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

async function fetchPairingsForRound(params, rd) {
  const url = buildUrl(params, { art: 2, rd });
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  return {
    round: rd,
    title: cleanText($('h2').eq(1).text()),
    table: parseTable($, $('table.CRs1').first()),
  };
}

async function getRoundPairings({ tnr, lan, fed, group, turdet, rd }) {
  const rdNum = parseInt(rd, 10);
  if (!tnr || !rdNum || rdNum < 1) {
    throw new UserFacingError('Thiếu tham số ván đấu.');
  }
  const params = { tnr, lan: lan || '29', fed: fed || '', group: group || '', turdet: turdet || 'YES' };
  const result = await fetchPairingsForRound(params, rdNum);
  if (!result.table) {
    throw new UserFacingError(`Chưa có dữ liệu cho ván ${rdNum}.`);
  }
  return result;
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
    const fetched = await fetchPairingsForRound(params, nav.currentPairingRound);
    pairings = {
      ...fetched,
      totalRounds: nav.totalRounds,
      isFinal: nav.pairingIsFinal,
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

async function getPlayerHistory({ tnr, lan, fed, group, turdet, snr }) {
  if (!tnr || !snr) {
    throw new UserFacingError('Thiếu thông tin để tra cứu đấu thủ.');
  }

  const params = new URLSearchParams();
  params.set('lan', lan || '29');
  params.set('art', '9');
  if (fed) params.set('fed', fed);
  params.set('turdet', turdet || 'YES');
  if (group) params.set('group', group);
  params.set('snr', snr);
  const url = `https://chess-results.com/tnr${tnr}.aspx?${params.toString()}`;

  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const tables = $('table.CRs1');

  if (tables.length < 2) {
    throw new UserFacingError('Không tìm thấy thông tin đấu thủ này.');
  }

  const bio = [];
  tables.eq(0).find('tr').each((i, tr) => {
    const tds = $(tr).find('td');
    if (tds.length >= 2) {
      bio.push({ label: cleanText($(tds[0]).text()), value: cleanText($(tds[1]).text()) });
    }
  });

  const history = parseTable($, tables.eq(1));

  return { bio, history };
}

export { getTournamentData, getPlayerHistory, getRoundPairings, parseInput, UserFacingError };
