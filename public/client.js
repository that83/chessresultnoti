(() => {
  const STORAGE_KEY = 'chessresultnoti.lastUrl';
  const FILTER_STORAGE_KEY = 'chessresultnoti.playerFilter';
  const POLL_MS = 45000;
  const HOVER_DELAY_MS = 180;

  const el = {
    urlInput: document.getElementById('urlInput'),
    trackBtn: document.getElementById('trackBtn'),
    errorMsg: document.getElementById('errorMsg'),
    statusBar: document.getElementById('statusBar'),
    tournamentName: document.getElementById('tournamentName'),
    lastUpdated: document.getElementById('lastUpdated'),
    notifyBtn: document.getElementById('notifyBtn'),
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
  };

  let lastHash = null;
  let pollTimer = null;
  let currentUrl = null;
  let currentMeta = null;

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

  function renderTable(tableEl, tableData) {
    tableEl.innerHTML = '';
    if (!tableData || !tableData.headers || tableData.headers.length === 0) {
      const p = document.createElement('caption');
      p.className = 'empty-note';
      p.textContent = 'Chưa có dữ liệu.';
      tableEl.appendChild(p);
      return;
    }
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    tableData.headers.forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h || '';
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    tableEl.appendChild(thead);

    const tbody = document.createElement('tbody');
    tableData.rows.forEach((row) => {
      const tr = document.createElement('tr');
      row.forEach((cell) => {
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

  function renderData(data, isFirstLoad) {
    currentMeta = data.meta;
    el.tournamentName.textContent = data.meta.tournamentName || 'Giải đấu';
    el.lastUpdated.textContent = 'Cập nhật lúc: ' + new Date(data.meta.fetchedAt).toLocaleString('vi-VN');
    el.statusBar.classList.remove('hidden');
    el.playerFilterBar.classList.remove('hidden');
    el.content.classList.remove('hidden');

    if (data.pairings) {
      const label = data.pairings.isFinal
        ? `Bảng xếp cặp / kết quả ván cuối (Ván ${data.pairings.round})`
        : `Bảng xếp cặp ván kế tiếp (Ván ${data.pairings.round}${data.pairings.totalRounds ? '/' + data.pairings.totalRounds : ''})`;
      el.pairingsTitle.textContent = label;
      renderTable(el.pairingsTable, data.pairings.table);
      document.getElementById('pairingsPanel').classList.remove('hidden');
    } else {
      document.getElementById('pairingsPanel').classList.add('hidden');
    }

    if (data.standings) {
      const label = data.standings.isFinal
        ? 'Bảng xếp hạng chung cuộc'
        : `Xếp hạng sau ván ${data.standings.round}`;
      el.standingsTitle.textContent = label;
      renderTable(el.standingsTable, data.standings.table);
      document.getElementById('standingsPanel').classList.remove('hidden');
    } else {
      document.getElementById('standingsPanel').classList.add('hidden');
    }

    if (data.startingList) {
      el.startingListTitle.textContent = data.startingList.title || 'Danh sách ban đầu';
      renderTable(el.startingListTable, data.startingList.table);
      document.getElementById('startingListPanel').classList.remove('hidden');
    } else {
      document.getElementById('startingListPanel').classList.add('hidden');
    }

    applyPlayerFilter();

    if (!isFirstLoad && lastHash !== null && data.hash !== lastHash) {
      notifyUpdate(data);
    }
    lastHash = data.hash;
  }

  function notifyUpdate(data) {
    el.updateBanner.classList.remove('hidden');
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

  async function loadData(url, isFirstLoad) {
    clearError();
    if (isFirstLoad) {
      el.loading.classList.remove('hidden');
      el.content.classList.add('hidden');
    }
    try {
      const res = await fetch('/api/tournament?url=' + encodeURIComponent(url));
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
    localStorage.setItem(STORAGE_KEY, currentUrl);
    loadData(currentUrl, true);
    startPolling(currentUrl);
  }

  el.trackBtn.addEventListener('click', () => track(el.urlInput.value));
  el.urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') track(el.urlInput.value);
  });
  el.refreshBtn.addEventListener('click', () => {
    if (currentUrl) loadData(currentUrl, false);
  });
  el.dismissBanner.addEventListener('click', () => {
    el.updateBanner.classList.add('hidden');
  });
  el.notifyBtn.addEventListener('click', async () => {
    if (!window.Notification) {
      showError('Trình duyệt của bạn không hỗ trợ thông báo.');
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      el.notifyBtn.textContent = '🔔 Đã bật thông báo';
      new Notification('Đã bật thông báo cho giải đấu', {
        body: 'Bạn sẽ được báo khi trang gốc có cập nhật (khi tab này vẫn đang mở).',
      });
    }
  });

  el.playerFilterInput.addEventListener('input', () => {
    localStorage.setItem(FILTER_STORAGE_KEY, el.playerFilterInput.value);
    applyPlayerFilter();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentUrl) {
      loadData(currentUrl, false);
    }
  });

  const savedFilter = localStorage.getItem(FILTER_STORAGE_KEY);
  if (savedFilter) {
    el.playerFilterInput.value = savedFilter;
  }

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    el.urlInput.value = saved;
    track(saved);
  }
})();
