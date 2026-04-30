/**
 * 渲染进程 — 剪贴板历史 + 设置面板
 * 无 ?. 与 ?? 语法
 */
(function () {
  // ─── DOM 引用 ──────────────────────────────────────────
  var searchInput = document.getElementById('searchInput');
  var statusIndicator = document.getElementById('statusIndicator');
  var settingsBtn = document.getElementById('settingsBtn');
  var settingsOverlay = document.getElementById('settingsOverlay');
  var settingsCloseBtn = document.getElementById('settingsCloseBtn');
  var historyList = document.getElementById('historyList');
  var emptyState = document.getElementById('emptyState');
  var toastEl = document.getElementById('toast');
  var editBtn = document.getElementById('editBtn');
  var batchBar = document.getElementById('batchBar');
  var batchCount = document.getElementById('batchCount');
  var batchSelectAllBtn = document.getElementById('batchSelectAllBtn');
  var batchDeleteBtn = document.getElementById('batchDeleteBtn');

  var modeHostBtn = document.getElementById('modeHost');
  var modeClientBtn = document.getElementById('modeClient');
  var serverUrlGroup = document.getElementById('serverUrlGroup');
  var portGroup = document.getElementById('portGroup');
  var serverUrlInput = document.getElementById('serverUrl');
  var portInput = document.getElementById('port');
  var autoLaunchInput = document.getElementById('autoLaunch');
  var saveBtn = document.getElementById('saveBtn');
  var statusDot = document.getElementById('statusDot');
  var statusText = document.getElementById('statusText');
  var statusDevice = document.getElementById('statusDevice');
  var versionText = document.getElementById('versionText');
  var checkUpdateBtn = document.getElementById('checkUpdateBtn');
  var updateInfo = document.getElementById('updateInfo');
  var newVersionText = document.getElementById('newVersionText');
  var updateNotes = document.getElementById('updateNotes');
  var downloadBtn = document.getElementById('downloadBtn');

  var filterTabs = document.querySelectorAll('.tab[data-filter]');

  var currentMode = 'host';
  var currentFilter = 'all';
  var searchQuery = '';
  var historyData = [];
  var filteredData = [];
  var pendingReleaseUrl = '';
  var isEditMode = false;
  var selectedIds = {};
  var lastClickedIndex = -1;

  // ─── 工具函数 ──────────────────────────────────────────

  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(function () {
      toastEl.classList.remove('show');
    }, 2000);
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function formatTime(isoStr) {
    var d = new Date(isoStr);
    var h = d.getHours();
    var m = d.getMinutes();
    return (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m);
  }

  // ─── 搜索 ──────────────────────────────────────────────

  searchInput.addEventListener('input', function () {
    searchQuery = searchInput.value.trim().toLowerCase();
    renderHistory();
  });

  // ─── 筛选标签 ──────────────────────────────────────────

  for (var i = 0; i < filterTabs.length; i++) {
    filterTabs[i].addEventListener('click', function () {
      for (var j = 0; j < filterTabs.length; j++) {
        filterTabs[j].classList.remove('active');
      }
      this.classList.add('active');
      currentFilter = this.getAttribute('data-filter');
      renderHistory();
    });
  }

  // ─── 历史列表渲染 ──────────────────────────────────────

  function filterEntries() {
    return historyData.filter(function (entry) {
      if (currentFilter !== 'all' && entry.type !== currentFilter) return false;
      if (searchQuery && entry.type === 'text') {
        return (entry.data || '').toLowerCase().indexOf(searchQuery) !== -1;
      }
      if (searchQuery && entry.type === 'image') return false;
      return true;
    });
  }

  function createCard(entry, filteredIndex) {
    var card = document.createElement('div');
    var classes = 'history-card';
    if (isEditMode) classes += ' editing';
    if (selectedIds[entry.id]) classes += ' checked';
    card.className = classes;
    card.setAttribute('data-id', entry.id);
    card.setAttribute('data-index', filteredIndex);

    var checkboxHtml = '<div class="card-checkbox"></div>';

    var dirLabel = entry.direction === 'push' ? '推送' : '接收';
    var dirClass = entry.direction === 'push' ? 'push' : 'sync';

    var headerHtml =
      '<div class="card-header">' +
        '<span class="card-direction ' + dirClass + '">' + dirLabel + '</span>' +
        '<span class="card-time">' + formatTime(entry.time) + '</span>' +
      '</div>';

    var contentHtml;
    if (entry.type === 'image') {
      if (entry.hasImage || (entry.data && entry.data.length > 200)) {
        contentHtml = '<div class="card-content image-preview" data-image-id="' + entry.id + '"><div style="color:var(--text3);font-size:12px;padding:8px 0">加载图片中...</div></div>';
      } else if (entry.data) {
        contentHtml = '<div class="card-content image-preview"><img src="data:image/png;base64,' + entry.data + '"></div>';
      } else {
        contentHtml = '<div class="card-content">[图片]</div>';
      }
    } else {
      contentHtml = '<div class="card-content">' + escapeHtml(entry.preview || entry.data || '') + '</div>';
    }

    var actionsHtml =
      '<div class="card-actions">' +
        '<button class="card-action-btn copy-btn" title="复制">📋</button>' +
        '<button class="card-action-btn danger delete-btn" title="删除">🗑</button>' +
      '</div>';

    card.innerHTML = checkboxHtml + headerHtml + contentHtml + actionsHtml;

    if (isEditMode) {
      card.addEventListener('click', function (e) {
        if (e.shiftKey && lastClickedIndex >= 0) {
          var from = Math.min(lastClickedIndex, filteredIndex);
          var to = Math.max(lastClickedIndex, filteredIndex);
          for (var s = from; s <= to; s++) {
            selectedIds[filteredData[s].id] = true;
          }
        } else {
          if (selectedIds[entry.id]) {
            delete selectedIds[entry.id];
          } else {
            selectedIds[entry.id] = true;
          }
        }
        lastClickedIndex = filteredIndex;
        renderHistory();
      });
    } else {
      card.querySelector('.copy-btn').addEventListener('click', function (e) {
        e.stopPropagation();
        window.clipboardAPI.copyHistoryItem(entry.id).then(function () {
          showToast('已复制到剪贴板');
        });
      });

      card.querySelector('.delete-btn').addEventListener('click', function (e) {
        e.stopPropagation();
        window.clipboardAPI.deleteHistoryItem(entry.id).then(function () {
          for (var k = 0; k < historyData.length; k++) {
            if (historyData[k].id === entry.id) {
              historyData.splice(k, 1);
              break;
            }
          }
          renderHistory();
        });
      });

      card.addEventListener('click', function () {
        window.clipboardAPI.copyHistoryItem(entry.id).then(function () {
          showToast('已复制到剪贴板');
        });
      });
    }

    return card;
  }

  function renderHistory() {
    filteredData = filterEntries();

    while (historyList.firstChild) {
      historyList.removeChild(historyList.firstChild);
    }

    if (filteredData.length === 0) {
      historyList.appendChild(emptyState);
      emptyState.style.display = '';
    } else {
      emptyState.style.display = 'none';
      for (var i = 0; i < filteredData.length; i++) {
        var card = createCard(filteredData[i], i);
        historyList.appendChild(card);
      }
      loadLazyImages();
    }

    updateBatchBar();
  }

  // ─── 批量选择 ──────────────────────────────────────────

  function enterEditMode() {
    isEditMode = true;
    selectedIds = {};
    lastClickedIndex = -1;
    editBtn.textContent = '取消';
    editBtn.title = '取消选择';
    batchBar.classList.add('show');
    historyList.classList.add('with-batch');
    settingsBtn.style.display = 'none';
    renderHistory();
  }

  function exitEditMode() {
    isEditMode = false;
    selectedIds = {};
    lastClickedIndex = -1;
    editBtn.textContent = '选择';
    editBtn.title = '批量选择';
    batchBar.classList.remove('show');
    historyList.classList.remove('with-batch');
    settingsBtn.style.display = '';
    renderHistory();
  }

  editBtn.addEventListener('click', function () {
    if (isEditMode) exitEditMode();
    else enterEditMode();
  });

  function getSelectedCount() {
    var count = 0;
    for (var key in selectedIds) {
      if (selectedIds[key]) count++;
    }
    return count;
  }

  function updateBatchBar() {
    if (!isEditMode) return;
    var count = getSelectedCount();
    batchCount.textContent = '已选择 ' + count + ' 项';
    batchDeleteBtn.disabled = count === 0;
    batchDeleteBtn.textContent = count > 0 ? '删除 (' + count + ')' : '删除';
    var allSelected = filteredData.length > 0 && count === filteredData.length;
    batchSelectAllBtn.textContent = allSelected ? '取消全选' : '全选';
  }

  batchSelectAllBtn.addEventListener('click', function () {
    var allSelected = getSelectedCount() === filteredData.length && filteredData.length > 0;
    if (allSelected) {
      selectedIds = {};
    } else {
      for (var i = 0; i < filteredData.length; i++) {
        selectedIds[filteredData[i].id] = true;
      }
    }
    lastClickedIndex = -1;
    renderHistory();
  });

  batchDeleteBtn.addEventListener('click', function () {
    var ids = [];
    for (var key in selectedIds) {
      if (selectedIds[key]) ids.push(key);
    }
    if (ids.length === 0) return;

    var idSet = {};
    for (var j = 0; j < ids.length; j++) idSet[ids[j]] = true;
    window.clipboardAPI.deleteHistoryItems(ids).then(function () {
      historyData = historyData.filter(function (entry) { return !idSet[entry.id]; });
      selectedIds = {};
      lastClickedIndex = -1;
      renderHistory();
      showToast('已删除 ' + ids.length + ' 条记录');
    });
  });

  function loadLazyImages() {
    var imgContainers = document.querySelectorAll('[data-image-id]');
    for (var i = 0; i < imgContainers.length; i++) {
      (function (container) {
        var id = container.getAttribute('data-image-id');
        if (container._loaded) return;
        container._loaded = true;
        window.clipboardAPI.getHistoryImage(id).then(function (base64) {
          if (base64) {
            container.innerHTML = '<img src="data:image/png;base64,' + base64 + '">';
          } else {
            container.innerHTML = '<span style="color:var(--text3);font-size:12px">[图片已丢失]</span>';
          }
        });
      })(imgContainers[i]);
    }
  }

  // ─── 加载历史 ──────────────────────────────────────────

  window.clipboardAPI.getHistory().then(function (data) {
    historyData = data || [];
    renderHistory();
  });

  window.clipboardAPI.onHistoryUpdate(function (entry) {
    historyData.unshift(entry);
    if (historyData.length > 100) historyData.pop();
    renderHistory();
  });

  window.clipboardAPI.onHistoryLoaded(function (data) {
    historyData = data || [];
    renderHistory();
  });

  // ─── 状态更新 ──────────────────────────────────────────

  function updateStatus(status) {
    if (!status) return;
    if (status.connected) {
      statusIndicator.classList.add('connected');
      statusIndicator.title = '已连接';
      statusDot.classList.add('connected');
      statusText.textContent = '已连接';
    } else {
      statusIndicator.classList.remove('connected');
      statusIndicator.title = status.running ? '连接中...' : '未连接';
      statusDot.classList.remove('connected');
      statusText.textContent = status.running ? '连接中...' : '未连接';
    }
    if (status.deviceId) {
      statusDevice.textContent = status.deviceId;
    }
    if (typeof status.autoLaunch === 'boolean') {
      autoLaunchInput.checked = status.autoLaunch;
    }
  }

  window.clipboardAPI.getStatus().then(updateStatus);
  window.clipboardAPI.onStatusChange(updateStatus);

  // ─── 设置面板 ──────────────────────────────────────────

  settingsBtn.addEventListener('click', function () {
    settingsOverlay.classList.add('show');
  });

  settingsCloseBtn.addEventListener('click', function () {
    settingsOverlay.classList.remove('show');
  });

  settingsOverlay.addEventListener('click', function (e) {
    if (e.target === settingsOverlay) {
      settingsOverlay.classList.remove('show');
    }
  });

  function setMode(mode) {
    currentMode = mode;
    if (mode === 'host') {
      modeHostBtn.classList.add('active');
      modeClientBtn.classList.remove('active');
      serverUrlGroup.style.display = 'none';
      portGroup.style.display = '';
    } else {
      modeHostBtn.classList.remove('active');
      modeClientBtn.classList.add('active');
      serverUrlGroup.style.display = '';
      portGroup.style.display = 'none';
    }
  }

  modeHostBtn.addEventListener('click', function () { setMode('host'); });
  modeClientBtn.addEventListener('click', function () { setMode('client'); });

  window.clipboardAPI.getConfig().then(function (config) {
    if (!config) return;
    setMode(config.mode || 'host');
    serverUrlInput.value = config.serverUrl || '';
    portInput.value = config.port || 3846;
    autoLaunchInput.checked = !!config.autoLaunch;
  });

  autoLaunchInput.addEventListener('change', function () {
    window.clipboardAPI.toggleAutoLaunch(autoLaunchInput.checked);
  });

  saveBtn.addEventListener('click', function () {
    var config = {
      mode: currentMode,
      serverUrl: serverUrlInput.value.replace(/\/+$/, ''),
      port: parseInt(portInput.value, 10) || 3846,
      autoLaunch: autoLaunchInput.checked
    };
    if (config.mode === 'client' && !config.serverUrl) {
      showToast('请输入服务器地址');
      return;
    }
    window.clipboardAPI.saveConfig(config).then(function () {
      showToast('已保存并应用');
      settingsOverlay.classList.remove('show');
    });
  });

  // ─── 版本与更新 ────────────────────────────────────────

  window.clipboardAPI.getAppVersion().then(function (ver) {
    if (ver) versionText.textContent = 'v' + ver;
  });

  checkUpdateBtn.addEventListener('click', function () {
    checkUpdateBtn.disabled = true;
    checkUpdateBtn.textContent = '检查中...';
    window.clipboardAPI.checkUpdate().then(function (result) {
      checkUpdateBtn.disabled = false;
      checkUpdateBtn.textContent = '检查更新';
      if (!result) return;
      if (result.error) {
        showToast('检查更新失败');
        return;
      }
      if (!result.hasUpdate) {
        showToast('已是最新版本');
        return;
      }
      newVersionText.textContent = 'v' + result.latestVersion;
      updateNotes.textContent = result.notes || '暂无更新说明';
      pendingReleaseUrl = result.releaseUrl || '';
      updateInfo.style.display = '';
    });
  });

  downloadBtn.addEventListener('click', function () {
    if (pendingReleaseUrl) {
      window.clipboardAPI.openReleaseUrl(pendingReleaseUrl);
    }
  });
})();
