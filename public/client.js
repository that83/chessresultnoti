(() => {
  const STORAGE_KEY = 'chessresultnoti.lastUrl';
  const FILTER_STORAGE_KEY = 'chessresultnoti.playerFilter';
  const HISTORY_KEY = 'chessresultnoti.history';
  const VISITOR_ID_KEY = 'chessresultnoti.visitorId';
  const HISTORY_MAX = 15;
  const POLL_MS = 45000;
  const HOVER_DELAY_MS = 180;
  const PLAYER_FILTER_TRACK_DELAY_MS = 1500;
  const CHANGELOG_MAX = 100;

  const el = {
    urlInput: document.getElementById('urlInput'),
    trackBtn: document.getElementById('trackBtn'),
    errorMsg: document.getElementById('errorMsg'),
    statusBar: document.getElementById('statusBar'),
    tournamentName: document.getElementById('tournamentName'),
    lastUpdated: document.getElementById('lastUpdated'),
    notifyBtn: document.getElementById('notifyBtn'),
    shareBtn: document.getElementById('shareBtn'),
    refreshBtn: document.getElementById('refreshBtn'),
    autoToggle: document.getElementById('autoToggle'),
    pollInterval: document.getElementById('pollInterval'),
    updateBanner: document.getElementById('updateBanner'),
    dismissBanner: document.getElementById('dismissBanner'),
    loading: document.getElementById('loading'),
    content: document.getElementById('content'),
    pairingsTitle: document.getElementById('pairingsTitle'),
    pairingsTable: document.getElementById('pairingsTable'),
    standingsTitle: document.getElementById('standingsTitle'),
    standingsTable: document.getElementById('standingsTable'),
    startingListTitle: document.getElementById('startingListTitle'),
    startingListTable: document.getElementById('startingListTable'),
    playerFilterBar: document.getElementById('playerFilterBar'),
    playerFilterInput: document.getElementById('playerFilterInput'),
    playerTooltip: document.getElementById('playerTooltip'),
    urlHistory: document.getElementById('urlHistory'),
    changeLogList: document.getElementById('changeLogList'),
    clearChangeLogBtn: document.getElementById('clearChangeLogBtn'),
    roundButtonsBar: document.getElementById('roundButtonsBar'),
    updateBannerText: document.getElementById('updateBannerText'),
  };

  let lastHash = null;
  let pollTimer = null;
  let currentUrl = null;
  let currentMeta = null;
  let lastStartingList = null;
  let lastStandings = null;
  let startingListSortByPoints = false;
  let selectedRound = null;
  let lastKnownCurrentRound = null;
  const baseTitle = document.title;
  let unreadCount = 0;
  let playerFilterTrackTimer = null;
  let pendingPlayerFilterValue = null;

  let visitorId = null;
  let isNewVisitor = false;
  try {
    visitorId = localStorage.getItem(VISITOR_ID_KEY);
    if (!visitorId) {
      visitorId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(36).slice(2));
      localStorage.setItem(VISITOR_ID_KEY, visitorId);
      isNewVisitor = true;
    }
  } catch (e) {
    // localStorage unavailable; skip visitor tracking
  }

  function sendTrackEvent(payload) {
    if (!visitorId) return;
    try {
      fetch('/api/track-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId, ...payload }),
        keepalive: true,
      }).catch(() => {});
    } catch (e) {
      // ignore
    }
  }

  function flushPlayerFilterTrack() {
    clearTimeout(playerFilterTrackTimer);
    playerFilterTrackTimer = null;
    if (pendingPlayerFilterValue) {
      sendTrackEvent({
        type: 'player_filter',
        tnr: currentMeta && currentMeta.tnr,
        group: currentMeta && currentMeta.group,
        playerName: pendingPlayerFilterValue,
      });
      pendingPlayerFilterValue = null;
    }
  }

  const playerDataCache = new Map();
  let hoverTimer = null;
  let hoverToken = 0;

  el.pollInterval.textContent = Math.round(POLL_MS / 1000);

  function showError(msg) {
    el.errorMsg.textContent = msg;
    el.errorMsg.classList.remove('hidden');
  }

  function clearError() {
    el.errorMsg.classList.add('hidden');
    el.errorMsg.textContent = '';
  }

  const DIACRITIC_MARKS_RE = new RegExp('[̀-ͯ]', 'g');

  function normalizeText(s) {
    return (s || '')
      .toLowerCase()
      .replace(/đ/g, 'd')
      .normalize('NFD')
      .replace(DIACRITIC_MARKS_RE, '')
      .trim();
  }

  function cellText(cell) {
    if (cell && typeof cell === 'object') return cell.text || '';
    return cell == null ? '' : String(cell);
  }

  function parseScore(text) {
    if (text === undefined || text === null) return null;
    const t = String(text).trim();
    if (t === '') return null;
    const n = parseFloat(t.replace(',', '.'));
    return Number.isNaN(n) ? null : n;
  }

  function getSharedUrlFromLocation() {
    try {
      return new URLSearchParams(window.location.search).get('g');
    } catch (e) {
      return null;
    }
  }

  function updateAppUrl(sourceUrl) {
    try {
      const newUrl = window.location.pathname + '?g=' + encodeURIComponent(sourceUrl);
      window.history.replaceState(null, '', newUrl);
    } catch (e) {
      // ignore (e.g. sandboxed context without history access)
    }
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistoryEntry(meta) {
    if (!meta || !meta.tnr) return;
    const key = meta.tnr + '|' + (meta.group || '');
    const list = loadHistory().filter((h) => h.key !== key);
    list.unshift({
      key,
      url: meta.sourceUrl,
      name: meta.tournamentName || meta.sourceUrl,
      group: meta.group || '',
      lastUsed: Date.now(),
    });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
    renderHistory();
  }

  function removeHistoryEntry(key) {
    const list = loadHistory().filter((h) => h.key !== key);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    renderHistory();
  }

  function renderHistory() {
    const list = loadHistory();
    el.urlHistory.innerHTML = '';
    if (!list.length) {
      el.urlHistory.classList.add('hidden');
      return;
    }
    el.urlHistory.classList.remove('hidden');

    const label = document.createElement('div');
    label.className = 'history-label';
    label.textContent = 'Giải đã xem gần đây:';
    el.urlHistory.appendChild(label);

    const listEl = document.createElement('div');
    listEl.className = 'history-list';

    list.forEach((h) => {
      const item = document.createElement('div');
      item.className = 'history-item';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'history-item-btn';
      btn.title = h.url;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'history-item-name';
      nameSpan.textContent = h.name;
      btn.appendChild(nameSpan);

      if (h.group) {
        const groupSpan = document.createElement('span');
        groupSpan.className = 'history-item-group';
        groupSpan.textContent = h.group;
        btn.appendChild(groupSpan);
      }

      btn.addEventListener('click', () => {
        el.urlInput.value = h.url;
        track(h.url);
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'history-item-remove';
      removeBtn.textContent = '×';
      removeBtn.title = 'Xoá khỏi danh sách';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeHistoryEntry(h.key);
      });

      item.appendChild(btn);
      item.appendChild(removeBtn);
      listEl.appendChild(item);
    });

    el.urlHistory.appendChild(listEl);
  }

  function hideTooltip() {
    clearTimeout(hoverTimer);
    hoverToken++;
    el.playerTooltip.classList.add('hidden');
  }

  function positionTooltipNear(anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    const tip = el.playerTooltip;
    tip.style.left = '0px';
    tip.style.top = '0px';
    tip.classList.remove('hidden');
    const tipRect = tip.getBoundingClientRect();

    let left = rect.left;
    let top = rect.bottom + 8;
    if (left + tipRect.width > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - tipRect.width - 12);
    }
    if (top + tipRect.height > window.innerHeight - 12) {
      top = rect.top - tipRect.height - 8;
      if (top < 12) top = 12;
    }
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  function renderTooltipContent(data) {
    const bioMap = {};
    (data.bio || []).forEach((b) => { bioMap[b.label] = b.value; });
    const name = bioMap['Tên'] || '';

    const wrap = document.createElement('div');

    const nameEl = document.createElement('div');
    nameEl.className = 'tt-name';
    nameEl.textContent = name;
    wrap.appendChild(nameEl);

    const bioKeys = ['Điểm', 'Hạng', 'Rating quốc tế', 'Hiệu suất thi đấu', 'CLB/Tỉnh'];
    const bioGrid = document.createElement('div');
    bioGrid.className = 'tt-bio';
    let any = false;
    bioKeys.forEach((k) => {
      if (bioMap[k] !== undefined && bioMap[k] !== '') {
        any = true;
        const label = document.createElement('span');
        label.textContent = k;
        const value = document.createElement('span');
        value.textContent = bioMap[k];
        bioGrid.appendChild(label);
        bioGrid.appendChild(value);
      }
    });
    if (any) wrap.appendChild(bioGrid);

    if (data.history && data.history.headers && data.history.headers.length) {
      // Chess-results' player-history table has a fixed layout:
      // [Round, Board, OpponentNo, "", OpponentName, Rating, Fed, Club, ScoreBefore, Result].
      // Keep just the columns useful for a quick glance so the tooltip stays compact.
      const allHeaders = data.history.headers;
      const colIndexes = allHeaders.length === 10 ? [0, 4, 8, 9] : allHeaders.map((_, i) => i);

      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const trh = document.createElement('tr');
      colIndexes.forEach((idx) => {
        const th = document.createElement('th');
        th.textContent = allHeaders[idx] || '';
        trh.appendChild(th);
      });
      thead.appendChild(trh);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      data.history.rows.forEach((row) => {
        const tr = document.createElement('tr');
        colIndexes.forEach((idx) => {
          const td = document.createElement('td');
          td.textContent = cellText(row[idx]);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      const scrollWrap = document.createElement('div');
      scrollWrap.className = 'tt-history-wrap';
      scrollWrap.appendChild(table);
      wrap.appendChild(scrollWrap);
    } else {
      const note = document.createElement('div');
      note.className = 'tt-loading';
      note.textContent = 'Chưa có ván nào.';
      wrap.appendChild(note);
    }

    el.playerTooltip.innerHTML = '';
    el.playerTooltip.appendChild(wrap);
  }

  async function showPlayerTooltip(span) {
    if (!currentMeta) return;
    const snr = span.dataset.snr;
    const fed = span.dataset.fed || '';
    const key = snr + '|' + fed;
    const token = ++hoverToken;

    positionTooltipNear(span);
    el.playerTooltip.innerHTML = '<div class="tt-loading">Đang tải...</div>';

    let data = playerDataCache.get(key);
    if (!data) {
      try {
        const params = new URLSearchParams({
          tnr: currentMeta.tnr,
          lan: currentMeta.lan,
          group: currentMeta.group,
          turdet: currentMeta.turdet,
          fed,
          snr,
        });
        const res = await fetch('/api/player?' + params.toString());
        data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Lỗi');
        playerDataCache.set(key, data);
      } catch (err) {
        if (token !== hoverToken) return;
        el.playerTooltip.innerHTML = '<div class="tt-error">Không tải được thông tin đấu thủ.</div>';
        return;
      }
    }

    if (token !== hoverToken) return;
    positionTooltipNear(span);
    renderTooltipContent(data);
    positionTooltipNear(span);
  }

  function attachPlayerHover(span) {
    span.addEventListener('mouseenter', () => {
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => showPlayerTooltip(span), HOVER_DELAY_MS);
    });
    span.addEventListener('mouseleave', () => {
      hideTooltip();
    });
  }

  function renderTable(tableEl, tableData, options) {
    const hideHeaders = (options && options.hideHeaders) || [];
    tableEl.innerHTML = '';
    if (!tableData || !tableData.headers || tableData.headers.length === 0) {
      const p = document.createElement('caption');
      p.className = 'empty-note';
      p.textContent = 'Chưa có dữ liệu.';
      tableEl.appendChild(p);
      return;
    }

    // chess-results.com includes empty "photo" placeholder columns (blank
    // header, always-empty cells) purely for layout on their own site.
    // We never populate a photo there, so drop those columns entirely -
    // it's dead width, especially costly on narrow screens. Only hide a
    // blank-header column if it's truly empty in every row, so we never
    // accidentally drop real data.
    const visibleIndexes = tableData.headers.map((h, i) => i).filter((i) => {
      const header = (tableData.headers[i] || '').trim();
      if (hideHeaders.includes(header)) return false;
      if (header !== '') return true;
      return tableData.rows.some((row) => cellText(row[i]).trim() !== '');
    });

    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    visibleIndexes.forEach((i) => {
      const th = document.createElement('th');
      th.textContent = tableData.headers[i] || '';
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    tableEl.appendChild(thead);

    const tbody = document.createElement('tbody');
    tableData.rows.forEach((row) => {
      const tr = document.createElement('tr');
      visibleIndexes.forEach((i) => {
        const cell = row[i];
        const td = document.createElement('td');
        if (cell && typeof cell === 'object' && cell.snr) {
          const span = document.createElement('span');
          span.className = 'player-link';
          span.textContent = cell.text;
          span.dataset.snr = cell.snr;
          span.dataset.fed = cell.fed || '';
          attachPlayerHover(span);
          td.appendChild(span);
        } else {
          td.textContent = cellText(cell);
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    tableEl.appendChild(tbody);
  }

  function buildStartingListTableData(startingListTable, standings) {
    const headers = startingListTable.headers.slice();
    const nameIdx = headers.findIndex((h) => h === 'Tên');
    const insertAt = nameIdx >= 0 ? nameIdx + 1 : headers.length;
    headers.splice(insertAt, 0, 'Điểm hiện tại');

    let scoreMap = null;
    if (standings && standings.table) {
      const sHeaders = standings.table.headers;
      const sNameIdx = sHeaders.findIndex((h) => h === 'Tên');
      const sScoreIdx = sHeaders.findIndex((h) => h === 'Điểm');
      if (sNameIdx >= 0 && sScoreIdx >= 0) {
        scoreMap = new Map();
        standings.table.rows.forEach((row) => {
          const nameCell = row[sNameIdx];
          if (nameCell && nameCell.snr != null) {
            scoreMap.set(nameCell.snr, cellText(row[sScoreIdx]));
          }
        });
      }
    }

    const decorated = startingListTable.rows.map((row, origIndex) => {
      const nameCell = nameIdx >= 0 ? row[nameIdx] : null;
      const snr = nameCell && nameCell.snr;
      let scoreText = '-';
      if (scoreMap) {
        scoreText = snr != null && scoreMap.has(snr) ? scoreMap.get(snr) : '0';
      }
      const newRow = row.slice();
      newRow.splice(insertAt, 0, { text: scoreText });
      return { row: newRow, origIndex, score: parseScore(scoreText) };
    });

    if (startingListSortByPoints) {
      decorated.sort((a, b) => {
        const as = a.score === null ? -Infinity : a.score;
        const bs = b.score === null ? -Infinity : b.score;
        if (bs !== as) return bs - as;
        return a.origIndex - b.origIndex;
      });
    }

    return { headers, rows: decorated.map((d) => d.row), scoreColIndex: insertAt };
  }

  function renderStartingListTable() {
    if (!lastStartingList) return;
    const augmented = buildStartingListTableData(lastStartingList, lastStandings);
    renderTable(el.startingListTable, augmented);

    // Locate by text, not by index: renderTable() may drop blank-header
    // columns, which shifts DOM positions relative to augmented.scoreColIndex.
    const ths = el.startingListTable.querySelectorAll('thead th');
    const th = Array.from(ths).find((t) => t.textContent.trim() === 'Điểm hiện tại');
    if (th) {
      th.classList.add('sortable');
      th.title = 'Bấm để sắp xếp theo điểm hiện tại (giảm dần), ưu tiên thứ tự ban đầu khi bằng điểm';
      th.textContent = 'Điểm hiện tại' + (startingListSortByPoints ? ' ▼' : ' ⇅');
      th.addEventListener('click', () => {
        startingListSortByPoints = !startingListSortByPoints;
        renderStartingListTable();
        applyPlayerFilter();
      });
    }
  }

  function snapshotStorageKey(tnr, group) {
    return `chessresultnoti.snapshot.${tnr}.${group}`;
  }

  function changeLogStorageKey(tnr, group) {
    return `chessresultnoti.changelog.${tnr}.${group}`;
  }

  function buildStartingListSnapshot(table) {
    const headers = table.headers;
    const nameIdx = headers.findIndex((h) => h === 'Tên');
    const fideIdx = headers.findIndex((h) => h === 'FideID');
    const ratingIdx = headers.findIndex((h) => h === 'RtQT');
    const noIdx = headers.findIndex((h) => h === 'Số');

    return table.rows
      .map((row, i) => {
        const nameCell = nameIdx >= 0 ? row[nameIdx] : null;
        const snr = nameCell && typeof nameCell === 'object' ? nameCell.snr : null;
        if (snr == null) return null;
        return {
          snr,
          name: nameIdx >= 0 ? cellText(row[nameIdx]) : '',
          fideId: fideIdx >= 0 ? cellText(row[fideIdx]) : '',
          rating: ratingIdx >= 0 ? cellText(row[ratingIdx]) : '',
          no: noIdx >= 0 ? cellText(row[noIdx]) : String(i + 1),
          position: i,
        };
      })
      .filter(Boolean);
  }

  function diffStartingListSnapshots(oldRows, newRows) {
    const changes = [];
    const oldBySnr = new Map(oldRows.map((p) => [p.snr, p]));
    const newBySnr = new Map(newRows.map((p) => [p.snr, p]));

    newRows.forEach((p) => {
      if (!oldBySnr.has(p.snr)) {
        changes.push({ type: 'added', name: p.name, no: p.no });
      }
    });
    oldRows.forEach((p) => {
      if (!newBySnr.has(p.snr)) {
        changes.push({ type: 'removed', name: p.name, no: p.no });
      }
    });
    newRows.forEach((p) => {
      const old = oldBySnr.get(p.snr);
      if (!old) return;
      if (old.name !== p.name) {
        changes.push({ type: 'name_changed', name: p.name, no: p.no, from: old.name, to: p.name });
      }
      if (old.rating !== p.rating) {
        changes.push({ type: 'rating_changed', name: p.name, no: p.no, from: old.rating, to: p.rating });
      }
      if (old.fideId !== p.fideId) {
        changes.push({ type: 'fideid_changed', name: p.name, no: p.no, from: old.fideId, to: p.fideId });
      }
      if (old.position !== p.position) {
        changes.push({ type: 'order_changed', name: p.name, no: p.no, from: old.position + 1, to: p.position + 1 });
      }
    });

    return changes;
  }

  function loadChangeLog(tnr, group) {
    try {
      const raw = localStorage.getItem(changeLogStorageKey(tnr, group));
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function appendChangeLog(tnr, group, newEntries) {
    if (!newEntries.length) return;
    const now = new Date().toISOString();
    const existing = loadChangeLog(tnr, group);
    const merged = [...newEntries.map((e) => ({ ...e, at: now })), ...existing].slice(0, CHANGELOG_MAX);
    try {
      localStorage.setItem(changeLogStorageKey(tnr, group), JSON.stringify(merged));
    } catch (e) {
      // storage full or unavailable; skip persisting
    }
  }

  function formatChangeEntry(e) {
    const time = new Date(e.at).toLocaleString('vi-VN');
    switch (e.type) {
      case 'added':
        return `➕ [${time}] Thêm đấu thủ mới: ${e.name} (STT ${e.no})`;
      case 'removed':
        return `➖ [${time}] Đấu thủ rời khỏi danh sách: ${e.name} (STT ${e.no})`;
      case 'rating_changed':
        return `🔄 [${time}] ${e.name}: RtQT thay đổi ${e.from || '(trống)'} → ${e.to || '(trống)'}`;
      case 'fideid_changed':
        return `🔄 [${time}] ${e.name}: FideID thay đổi ${e.from || '(trống)'} → ${e.to || '(trống)'}`;
      case 'order_changed':
        return `↕️ [${time}] ${e.name}: Thứ tự thay đổi #${e.from} → #${e.to}`;
      case 'name_changed':
        return `✏️ [${time}] STT ${e.no}: Tên thay đổi "${e.from}" → "${e.to}"`;
      default:
        return '';
    }
  }

  function renderChangeLog(tnr, group) {
    const log = loadChangeLog(tnr, group);
    el.changeLogList.innerHTML = '';
    if (!log.length) {
      const p = document.createElement('div');
      p.className = 'empty-note';
      p.textContent = 'Chưa phát hiện thay đổi nào so với lần xem trước trên trình duyệt này.';
      el.changeLogList.appendChild(p);
      return;
    }
    log.forEach((e) => {
      const div = document.createElement('div');
      div.className = 'changelog-entry ' + e.type;
      div.textContent = formatChangeEntry(e);
      el.changeLogList.appendChild(div);
    });
  }

  function trackStartingListChanges(tnr, group, startingListTable) {
    const newSnap = buildStartingListSnapshot(startingListTable);
    let oldSnap = null;
    try {
      const raw = localStorage.getItem(snapshotStorageKey(tnr, group));
      oldSnap = raw ? JSON.parse(raw) : null;
    } catch (e) {
      oldSnap = null;
    }

    if (oldSnap) {
      const changes = diffStartingListSnapshots(oldSnap, newSnap);
      if (changes.length) {
        appendChangeLog(tnr, group, changes);
        markUnreadUpdate();
      }
    }

    try {
      localStorage.setItem(snapshotStorageKey(tnr, group), JSON.stringify(newSnap));
    } catch (e) {
      // storage full or unavailable; skip persisting the snapshot
    }

    renderChangeLog(tnr, group);
  }

  function applyPlayerFilter() {
    const q = normalizeText(el.playerFilterInput.value);
    document.querySelectorAll('#content table tbody tr').forEach((tr) => {
      if (!q) {
        tr.classList.remove('highlight');
        return;
      }
      const text = normalizeText(tr.textContent);
      tr.classList.toggle('highlight', text.includes(q));
    });
  }

  function roundCacheKey(tnr, group, rd) {
    return `chessresultnoti.round.${tnr}.${group}.${rd}`;
  }

  function loadRoundFromCache(tnr, group, rd) {
    try {
      const raw = localStorage.getItem(roundCacheKey(tnr, group, rd));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveRoundToCache(tnr, group, rd, data) {
    try {
      localStorage.setItem(roundCacheKey(tnr, group, rd), JSON.stringify(data));
    } catch (e) {
      // storage full or unavailable; skip persisting
    }
  }

  function tablesDiffer(a, b) {
    return JSON.stringify(a) !== JSON.stringify(b);
  }

  async function fetchRoundData(meta, rd) {
    const params = new URLSearchParams({
      tnr: meta.tnr,
      lan: meta.lan,
      group: meta.group,
      turdet: meta.turdet,
      fed: meta.fed || '',
      rd,
    });
    const res = await fetch('/api/round?' + params.toString());
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi');
    return data;
  }

  function alertRoundChanged(rd) {
    showUpdateBanner(`⚠️ Kết quả ván ${rd} vừa có thay đổi so với dữ liệu đã lưu trước đó!`);
    try {
      alert(`Kết quả ván ${rd} vừa có thay đổi so với dữ liệu đã lưu trước đó trên trình duyệt này. Vui lòng kiểm tra lại.`);
    } catch (e) {
      // alert() may be unavailable in some contexts; the banner above still shows
    }
  }

  async function preloadRound(meta, rd) {
    const cached = loadRoundFromCache(meta.tnr, meta.group, rd);
    let fresh;
    try {
      fresh = await fetchRoundData(meta, rd);
    } catch (e) {
      return; // will retry on next load/poll
    }
    const changed = cached && tablesDiffer(cached.table, fresh.table);
    saveRoundToCache(meta.tnr, meta.group, rd, fresh);
    if (changed) {
      alertRoundChanged(rd);
      if (selectedRound === rd) {
        el.pairingsTitle.textContent = `Bảng xếp cặp / kết quả ván ${rd}`;
        renderTable(el.pairingsTable, fresh.table, { hideHeaders: ['CLB/Tỉnh'] });
        applyPlayerFilter();
      }
    }
  }

  function preloadHistoricalRounds(meta, uptoExclusive) {
    for (let r = 1; r < uptoExclusive; r++) {
      preloadRound(meta, r);
    }
  }

  async function showSelectedRound(meta, rd) {
    const cached = loadRoundFromCache(meta.tnr, meta.group, rd);
    if (cached) {
      el.pairingsTitle.textContent = `Bảng xếp cặp / kết quả ván ${rd} (đã lưu cục bộ)`;
      renderTable(el.pairingsTable, cached.table, { hideHeaders: ['CLB/Tỉnh'] });
      applyPlayerFilter();
    } else {
      el.pairingsTitle.textContent = `Đang tải ván ${rd}...`;
      renderTable(el.pairingsTable, { headers: [], rows: [] });
    }

    try {
      const fresh = await fetchRoundData(meta, rd);
      const changed = cached && tablesDiffer(cached.table, fresh.table);
      saveRoundToCache(meta.tnr, meta.group, rd, fresh);
      if (selectedRound === rd) {
        el.pairingsTitle.textContent = `Bảng xếp cặp / kết quả ván ${rd}`;
        renderTable(el.pairingsTable, fresh.table, { hideHeaders: ['CLB/Tỉnh'] });
        applyPlayerFilter();
      }
      if (changed) {
        alertRoundChanged(rd);
      }
    } catch (e) {
      if (!cached && selectedRound === rd) {
        el.pairingsTitle.textContent = `Không tải được ván ${rd}`;
      }
    }
  }

  function selectRound(meta, rd, currentRound) {
    if (rd === currentRound) {
      selectedRound = null;
    } else {
      selectedRound = rd;
      showSelectedRound(meta, rd);
    }
    renderRoundButtons(meta, currentRound);
    if (selectedRound === null) {
      renderLivePairings(lastPairingsData);
    }
  }

  function renderRoundButtons(meta, currentRound) {
    el.roundButtonsBar.innerHTML = '';
    if (!currentRound || currentRound < 2) {
      el.roundButtonsBar.classList.add('hidden');
      return;
    }
    el.roundButtonsBar.classList.remove('hidden');
    for (let r = 1; r <= currentRound; r++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'round-btn' + ((selectedRound === null ? r === currentRound : r === selectedRound) ? ' active' : '');
      btn.textContent = r === currentRound ? `V${r} (hiện tại)` : `V${r}`;
      btn.addEventListener('click', () => selectRound(meta, r, currentRound));
      el.roundButtonsBar.appendChild(btn);
    }
  }

  let lastPairingsData = null;

  function renderLivePairings(pairings) {
    if (!pairings) {
      document.getElementById('pairingsPanel').classList.add('hidden');
      return;
    }
    document.getElementById('pairingsPanel').classList.remove('hidden');
    const label = pairings.isFinal
      ? `Bảng xếp cặp / kết quả ván cuối (Ván ${pairings.round})`
      : `Bảng xếp cặp ván kế tiếp (Ván ${pairings.round}${pairings.totalRounds ? '/' + pairings.totalRounds : ''})`;
    el.pairingsTitle.textContent = label;
    renderTable(el.pairingsTable, pairings.table, { hideHeaders: ['CLB/Tỉnh'] });
    applyPlayerFilter();
  }

  function renderPairingsPanel(meta, pairings) {
    lastPairingsData = pairings;
    if (!pairings) {
      document.getElementById('pairingsPanel').classList.add('hidden');
      el.roundButtonsBar.classList.add('hidden');
      return;
    }

    const currentRound = pairings.round;
    renderRoundButtons(meta, currentRound);

    if (selectedRound === null) {
      renderLivePairings(pairings);
    } else if (selectedRound === currentRound) {
      selectedRound = null;
      renderLivePairings(pairings);
    }
    // else: user is browsing a historical round; leave that view as-is,
    // it updates itself via showSelectedRound/preloadRound.

    if (lastKnownCurrentRound === null) {
      preloadHistoricalRounds(meta, currentRound);
    } else if (currentRound > lastKnownCurrentRound) {
      for (let r = lastKnownCurrentRound; r < currentRound; r++) {
        preloadRound(meta, r);
      }
    }
    lastKnownCurrentRound = currentRound;
  }

  function renderData(data, isFirstLoad) {
    currentMeta = data.meta;
    el.tournamentName.textContent = data.meta.tournamentName || 'Giải đấu';
    el.lastUpdated.textContent = 'Cập nhật lúc: ' + new Date(data.meta.fetchedAt).toLocaleString('vi-VN');
    el.statusBar.classList.remove('hidden');
    el.playerFilterBar.classList.remove('hidden');
    el.content.classList.remove('hidden');

    renderPairingsPanel(data.meta, data.pairings);

    if (data.standings) {
      const label = data.standings.isFinal
        ? 'Bảng xếp hạng chung cuộc'
        : `Xếp hạng sau ván ${data.standings.round}`;
      el.standingsTitle.textContent = label;
      renderTable(el.standingsTable, data.standings.table, { hideHeaders: ['CLB/Tỉnh'] });
      document.getElementById('standingsPanel').classList.remove('hidden');
    } else {
      document.getElementById('standingsPanel').classList.add('hidden');
    }

    if (data.startingList) {
      el.startingListTitle.textContent = data.startingList.title || 'Danh sách ban đầu';
      lastStartingList = data.startingList.table;
      lastStandings = data.standings;
      renderStartingListTable();
      document.getElementById('startingListPanel').classList.remove('hidden');
      trackStartingListChanges(data.meta.tnr, data.meta.group, data.startingList.table);
      document.getElementById('changeLogPanel').classList.remove('hidden');
    } else {
      lastStartingList = null;
      document.getElementById('startingListPanel').classList.add('hidden');
      document.getElementById('changeLogPanel').classList.add('hidden');
    }

    applyPlayerFilter();

    if (isFirstLoad) {
      saveHistoryEntry(data.meta);
      updateAppUrl(data.meta.sourceUrl);
      sendTrackEvent({
        type: 'view_tournament',
        tnr: data.meta.tnr,
        group: data.meta.group,
        tournamentName: data.meta.tournamentName,
        url: data.meta.sourceUrl,
      });
    }

    if (!isFirstLoad && lastHash !== null && data.hash !== lastHash) {
      notifyUpdate(data);
    }
    lastHash = data.hash;
  }

  function isPageActive() {
    return document.visibilityState === 'visible' && document.hasFocus();
  }

  function updateTabTitle() {
    document.title = unreadCount > 0 ? `(${unreadCount}) ${baseTitle}` : baseTitle;
  }

  function markUnreadUpdate() {
    if (isPageActive()) return;
    unreadCount += 1;
    updateTabTitle();
  }

  function clearUnreadUpdate() {
    if (unreadCount === 0) return;
    unreadCount = 0;
    updateTabTitle();
  }

  function syncNotifyButtonUI() {
    if (!window.Notification) {
      el.notifyBtn.textContent = '🔕 Trình duyệt không hỗ trợ';
      el.notifyBtn.disabled = true;
      return;
    }
    if (Notification.permission === 'granted') {
      el.notifyBtn.textContent = '🔔 Thông báo đang bật';
    } else if (Notification.permission === 'denied') {
      el.notifyBtn.textContent = '🔕 Thông báo bị chặn';
    } else {
      el.notifyBtn.textContent = '🔔 Bật thông báo';
    }
  }

  function requestNotificationPermissionIfNeeded() {
    if (window.Notification && Notification.permission === 'default') {
      Notification.requestPermission().then(syncNotifyButtonUI).catch(() => {});
    }
  }

  function showUpdateBanner(text) {
    el.updateBannerText.textContent = text;
    el.updateBanner.classList.remove('hidden');
    markUnreadUpdate();
  }

  function notifyUpdate(data) {
    showUpdateBanner('⚡ Có cập nhật mới!');
    let body = 'Trang giải đấu vừa có thay đổi mới.';
    if (data.pairings && !data.pairings.isFinal) {
      body = `Có cập nhật cho ván ${data.pairings.round}.`;
    } else if (data.standings) {
      body = `Có cập nhật xếp hạng sau ván ${data.standings.round}.`;
    }
    if (window.Notification && Notification.permission === 'granted') {
      try {
        new Notification('Cập nhật giải đấu: ' + (data.meta.tournamentName || ''), {
          body,
          tag: 'chessresultnoti-' + data.meta.tnr,
        });
      } catch (e) {
        // ignore notification errors (e.g. unsupported context)
      }
    }
  }

  async function loadData(url, isFirstLoad, force) {
    clearError();
    if (isFirstLoad) {
      el.loading.classList.remove('hidden');
      el.content.classList.add('hidden');
    }
    try {
      const qs = new URLSearchParams({ url });
      if (force) qs.set('fresh', '1');
      const res = await fetch('/api/tournament?' + qs.toString());
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Có lỗi xảy ra.');
      }
      renderData(data, isFirstLoad);
    } catch (err) {
      showError(err.message || 'Không tải được dữ liệu.');
    } finally {
      el.loading.classList.add('hidden');
    }
  }

  function startPolling(url) {
    stopPolling();
    pollTimer = setInterval(() => {
      if (el.autoToggle.checked) {
        loadData(url, false);
      }
    }, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function track(url) {
    if (!url || !url.trim()) {
      showError('Vui lòng nhập URL của giải đấu.');
      return;
    }
    currentUrl = url.trim();
    lastHash = null;
    playerDataCache.clear();
    startingListSortByPoints = false;
    selectedRound = null;
    lastKnownCurrentRound = null;
    localStorage.setItem(STORAGE_KEY, currentUrl);
    loadData(currentUrl, true);
    startPolling(currentUrl);
  }

  el.trackBtn.addEventListener('click', () => {
    requestNotificationPermissionIfNeeded();
    track(el.urlInput.value);
  });
  el.urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      requestNotificationPermissionIfNeeded();
      track(el.urlInput.value);
    }
  });
  el.refreshBtn.addEventListener('click', async () => {
    if (!currentUrl || el.refreshBtn.disabled) return;
    const originalText = el.refreshBtn.textContent;
    el.refreshBtn.disabled = true;
    el.refreshBtn.textContent = '↻ Đang làm mới...';
    try {
      await loadData(currentUrl, false, true);
    } finally {
      el.refreshBtn.disabled = false;
      el.refreshBtn.textContent = originalText;
    }
  });
  el.dismissBanner.addEventListener('click', () => {
    el.updateBanner.classList.add('hidden');
  });
  el.clearChangeLogBtn.addEventListener('click', () => {
    if (!currentMeta) return;
    localStorage.removeItem(changeLogStorageKey(currentMeta.tnr, currentMeta.group));
    renderChangeLog(currentMeta.tnr, currentMeta.group);
  });
  el.shareBtn.addEventListener('click', async () => {
    const originalText = el.shareBtn.textContent;
    try {
      await navigator.clipboard.writeText(window.location.href);
      el.shareBtn.textContent = '✅ Đã copy!';
    } catch (e) {
      el.shareBtn.textContent = '⚠️ Copy thủ công từ thanh địa chỉ';
    }
    setTimeout(() => {
      el.shareBtn.textContent = originalText;
    }, 1800);
  });
  el.notifyBtn.addEventListener('click', async () => {
    if (!window.Notification) {
      showError('Trình duyệt của bạn không hỗ trợ thông báo.');
      return;
    }
    if (Notification.permission === 'denied') {
      showError('Thông báo đã bị chặn cho trang này. Vào cài đặt trình duyệt (biểu tượng khoá/thông tin cạnh URL) để bật lại.');
      return;
    }
    if (Notification.permission === 'granted') {
      syncNotifyButtonUI();
      return;
    }
    const perm = await Notification.requestPermission();
    syncNotifyButtonUI();
    if (perm === 'granted') {
      new Notification('Đã bật thông báo cho giải đấu', {
        body: 'Bạn sẽ được báo khi trang gốc có cập nhật (khi tab này vẫn đang mở).',
      });
    }
  });

  el.playerFilterInput.addEventListener('input', () => {
    localStorage.setItem(FILTER_STORAGE_KEY, el.playerFilterInput.value);
    applyPlayerFilter();

    clearTimeout(playerFilterTrackTimer);
    const value = el.playerFilterInput.value.trim();
    if (value) {
      pendingPlayerFilterValue = value;
      playerFilterTrackTimer = setTimeout(flushPlayerFilterTrack, PLAYER_FILTER_TRACK_DELAY_MS);
    } else {
      pendingPlayerFilterValue = null;
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushPlayerFilterTrack();
    }
    if (document.visibilityState === 'visible' && currentUrl) {
      loadData(currentUrl, false);
    }
    if (isPageActive()) {
      clearUnreadUpdate();
    }
  });

  window.addEventListener('focus', () => {
    if (isPageActive()) {
      clearUnreadUpdate();
    }
  });

  window.addEventListener('pagehide', flushPlayerFilterTrack);
  el.playerFilterInput.addEventListener('blur', flushPlayerFilterTrack);

  const savedFilter = localStorage.getItem(FILTER_STORAGE_KEY);
  if (savedFilter) {
    el.playerFilterInput.value = savedFilter;
  }

  renderHistory();
  syncNotifyButtonUI();

  if (isNewVisitor) {
    sendTrackEvent({ type: 'new_visitor' });
  }

  const saved = getSharedUrlFromLocation() || localStorage.getItem(STORAGE_KEY);
  if (saved) {
    el.urlInput.value = saved;
    track(saved);
  }
})();
