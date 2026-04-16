/**
 * 渲染进程逻辑 — 设置窗口
 * 无 ?. 与 ?? 语法
 */
(function () {
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
  var logsWrap = document.getElementById('logsWrap');
  var toastEl = document.getElementById('toast');

  var currentMode = 'host';

  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(function () {
      toastEl.classList.remove('show');
    }, 2000);
  }

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

  function badgeClass(type) {
    if (type === 'push') return 'push';
    if (type === 'sync') return 'sync';
    if (type === 'error') return 'error';
    return 'info';
  }

  function badgeLabel(type) {
    if (type === 'push') return '推送';
    if (type === 'sync') return '接收';
    if (type === 'error') return '错误';
    return '信息';
  }

  function renderLogEntry(log) {
    var div = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML =
      '<span class="log-time">' + escapeHtml(log.time) + '</span>' +
      '<span class="log-badge ' + badgeClass(log.type) + '">' + badgeLabel(log.type) + '</span>' +
      '<span class="log-text">' + escapeHtml(log.text) + '</span>';
    return div;
  }

  function renderLogs(logs) {
    logsWrap.innerHTML = '';
    if (!logs || logs.length === 0) {
      logsWrap.innerHTML = '<div style="color:var(--text2); text-align:center; padding:12px 0">暂无记录</div>';
      return;
    }
    for (var i = 0; i < logs.length; i++) {
      logsWrap.appendChild(renderLogEntry(logs[i]));
    }
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function updateStatus(status) {
    if (!status) return;
    if (status.connected) {
      statusDot.classList.add('connected');
      statusText.textContent = '已连接';
    } else {
      statusDot.classList.remove('connected');
      statusText.textContent = status.running ? '连接中...' : '未连接';
    }
    if (status.deviceId) {
      statusDevice.textContent = status.deviceId;
    }
  }

  // 加载配置
  window.clipboardAPI.getConfig().then(function (config) {
    if (!config) return;
    setMode(config.mode || 'host');
    serverUrlInput.value = config.serverUrl || '';
    portInput.value = config.port || 3846;
    autoLaunchInput.checked = !!config.autoLaunch;
  });

  // 加载状态
  window.clipboardAPI.getStatus().then(function (status) {
    updateStatus(status);
    if (status && status.logs) {
      renderLogs(status.logs);
    }
  });

  // 实时状态更新
  window.clipboardAPI.onStatusChange(function (status) {
    updateStatus(status);
  });

  // 实时日志
  window.clipboardAPI.onSyncLog(function (log) {
    var placeholder = logsWrap.querySelector('div[style]');
    if (placeholder) logsWrap.innerHTML = '';
    var entry = renderLogEntry(log);
    if (logsWrap.firstChild) {
      logsWrap.insertBefore(entry, logsWrap.firstChild);
    } else {
      logsWrap.appendChild(entry);
    }
    // 限制显示条数
    while (logsWrap.children.length > 20) {
      logsWrap.removeChild(logsWrap.lastChild);
    }
  });

  // 保存
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
    });
  });
})();
