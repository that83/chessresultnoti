(() => {
  const STORAGE_KEY = 'chessresultnoti.lastUrl';
  const POLL_MS = 45000;

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
  };

  let lastHash = null;
  let pollTimer = null;
  let currentUrl = null;

  el.pollInterval.textContent = Math.round(POLL_MS / 1000);

  function showError(msg) {
    el.errorMsg.textContent = msg;
    el.errorMsg.classList.remove('hidden');
  }

  function clearError() {
    el.errorMsg.classList.add('hidden');
    el.errorMsg.textContent = '';
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
        td.textContent = cell;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    tableEl.appendChild(tbody);
  }

  function renderData(data, isFirstLoad) {
    el.tournamentName.textContent = data.meta.tournamentName || 'Giải đấu';
    el.lastUpdated.textContent = 'Cập nhật lúc: ' + new Date(data.meta.fetchedAt).toLocaleString('vi-VN');
    el.statusBar.classList.remove('hidden');
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

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentUrl) {
      loadData(currentUrl, false);
    }
  });

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    el.urlInput.value = saved;
    track(saved);
  }
})();
