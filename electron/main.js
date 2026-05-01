/**
 * Electron 主进程入口
 *
 * 管理系统托盘、设置窗口、同步引擎和内嵌服务端
 */
var electron = require('electron');
var app = electron.app;
var BrowserWindow = electron.BrowserWindow;
var ipcMain = electron.ipcMain;
var path = require('path');
var http = require('http');

var electronClipboard = electron.clipboard;
var trayModule = require('./tray');
var SyncEngine = require('./sync-engine');
var EmbeddedServer = require('./server-embed');
var Store = require('./store');
var updater = require('./updater');

process.on('uncaughtException', function (err) {
  if (err && err.message && err.message.indexOf('write EIO') !== -1) return;
  console.error('Uncaught:', err);
});

var mainWindow = null;
var engine = new SyncEngine();
var server = new EmbeddedServer();
var store = new Store();
var syncLogs = [];
var MAX_LOGS = 50;

var clipboardHistory = [];
var skipNextHistoryDeleted = false;

function simpleGet(url, callback) {
  var parsed = new URL(url);
  var req = http.get({
    hostname: parsed.hostname,
    port: parsed.port || 80,
    path: parsed.pathname + parsed.search,
    timeout: 5000
  }, function (res) {
    var chunks = [];
    res.setEncoding('utf8');
    res.on('data', function (c) { chunks.push(c); });
    res.on('end', function () {
      try { callback(null, JSON.parse(chunks.join(''))); }
      catch (e) { callback(e, null); }
    });
  });
  req.on('error', function (e) { callback(e, null); });
  req.on('timeout', function () { req.destroy(); callback(new Error('timeout'), null); });
}

function simplePost(url, body, callback) {
  var parsed = new URL(url);
  var postData = JSON.stringify(body);
  var req = http.request({
    hostname: parsed.hostname,
    port: parsed.port || 80,
    path: parsed.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    },
    timeout: 5000
  }, function (res) {
    var chunks = [];
    res.setEncoding('utf8');
    res.on('data', function (c) { chunks.push(c); });
    res.on('end', function () {
      try { callback(null, JSON.parse(chunks.join(''))); }
      catch (e) { callback(e, null); }
    });
  });
  req.on('error', function (e) { callback(e, null); });
  req.on('timeout', function () { req.destroy(); callback(new Error('timeout'), null); });
  req.write(postData);
  req.end();
}

function simpleDelete(url, callback) {
  var parsed = new URL(url);
  var req = http.request({
    hostname: parsed.hostname,
    port: parsed.port || 80,
    path: parsed.pathname,
    method: 'DELETE',
    timeout: 5000
  }, function (res) {
    var chunks = [];
    res.setEncoding('utf8');
    res.on('data', function (c) { chunks.push(c); });
    res.on('end', function () {
      try { callback(null, JSON.parse(chunks.join(''))); }
      catch (e) { callback(e, null); }
    });
  });
  req.on('error', function (e) { callback(e, null); });
  req.end();
}

function loadHistoryFromServer() {
  var config = store.getAll();
  var serverUrl = getEffectiveServerUrl(config);
  if (!serverUrl) return;
  simpleGet(serverUrl + '/api/history', function (err, data) {
    if (err || !Array.isArray(data)) return;
    clipboardHistory = data.map(function (entry) {
      return {
        id: entry.id,
        type: entry.type,
        data: entry.data || '',
        preview: entry.preview || '',
        direction: entry.direction === engine.deviceId ? 'push' : 'sync',
        time: entry.time,
        hasImage: entry.hasImage
      };
    });
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.webContents.send('history-loaded', clipboardHistory); } catch (_) {}
    }
  });
}

function addHistoryEntry(type, data, direction) {
  var entry = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    type: type,
    data: data,
    direction: direction,
    time: new Date().toISOString(),
    preview: type === 'image' ? '[图片]' : (data.length > 200 ? data.substring(0, 200) : data)
  };
  clipboardHistory.unshift(entry);
  if (clipboardHistory.length > 100) clipboardHistory.pop();
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('history-update', entry); } catch (_) {}
  }
}

// macOS: 窗口隐藏时同时隐藏 Dock 图标

function addLog(type, text) {
  var entry = {
    type: type,
    text: text.length > 80 ? text.substring(0, 80) + '...' : text,
    time: new Date().toLocaleTimeString()
  };
  syncLogs.unshift(entry);
  if (syncLogs.length > MAX_LOGS) syncLogs.pop();
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('sync-log', entry); } catch (_) {}
  }
}

function getEffectiveServerUrl(config) {
  if (config.mode === 'host') {
    return 'http://localhost:' + (config.port || 3846);
  }
  return config.serverUrl || '';
}

function startSync() {
  var config = store.getAll();
  var serverUrl = getEffectiveServerUrl(config);
  if (!serverUrl) return;

  if (config.mode === 'host' && !server.running) {
    server.start(config.port || 3846, function (err) {
      if (err) {
        addLog('error', '服务端启动失败: ' + err.message);
        return;
      }
      addLog('info', '内嵌服务端已启动 (端口 ' + (config.port || 3846) + ')');
      engine.start(serverUrl);
    });
  } else {
    engine.start(serverUrl);
  }
}

function stopSync() {
  engine.stop();
  if (server.running) {
    server.stop();
  }
}

function broadcastStatus() {
  var status = {
    connected: engine.connected,
    running: engine.running,
    serverRunning: server.running,
    deviceId: engine.deviceId,
    autoLaunch: !!store.get('autoLaunch')
  };
  trayModule.updateMenu({
    connected: engine.connected,
    autoLaunch: store.get('autoLaunch'),
    onShowWindow: showWindow,
    onToggleAutoLaunch: toggleAutoLaunch,
    onCheckUpdate: function () { doCheckUpdate(false); },
    onQuit: quitApp
  });
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('status-changed', status); } catch (_) {}
  }
}

// ─── 同步引擎事件 ─────────────────────────────────────────

engine.on('connected', function () {
  addLog('info', '已连接到服务器');
  broadcastStatus();
  loadHistoryFromServer();
});

engine.on('disconnected', function () {
  addLog('info', '与服务器断开连接');
  broadcastStatus();
});

engine.on('pushing', function (msg) {
  addLog('info', msg);
});

engine.on('pushed', function (text) {
  addLog('push', text);
  var isImage = text.indexOf('[图片') === 0;
  addHistoryEntry(
    isImage ? 'image' : 'text',
    isImage ? engine._lastPushedImageData || '' : text,
    'push'
  );
});

engine.on('syncing', function (msg) {
  addLog('info', msg);
});

engine.on('synced', function (text) {
  addLog('sync', text);
  var isImage = text.indexOf('[图片') === 0;
  addHistoryEntry(
    isImage ? 'image' : 'text',
    isImage ? engine._lastSyncedImageData || '' : text,
    'sync'
  );
});

engine.on('error', function (err) {
  addLog('error', err.message || '未知错误');
});

engine.on('history-deleted', function () {
  if (skipNextHistoryDeleted) {
    skipNextHistoryDeleted = false;
    return;
  }
  loadHistoryFromServer();
});

// ─── 窗口管理 ─────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
    minWidth: 320,
    minHeight: 400,
    resizable: true,
    show: false,
    frame: true,
    title: 'ClipboardShare',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('close', function (e) {
    e.preventDefault();
    mainWindow.hide();
    if (process.platform === 'darwin' && app.dock) {
      app.dock.hide();
    }
  });
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  if (process.platform === 'darwin' && app.dock) {
    app.dock.show();
  }
  mainWindow.show();
  mainWindow.focus();
}

// ─── 开机自启 ─────────────────────────────────────────────

function setAutoLaunch(enabled) {
  try {
    var settings = { openAtLogin: enabled };
    if (process.platform === 'win32') {
      settings.path = process.execPath;
      settings.args = [];
    }
    app.setLoginItemSettings(settings);
    var result = app.getLoginItemSettings();
    addLog('info', '开机自启: ' + (result.openAtLogin ? '已开启' : '已关闭'));
  } catch (e) {
    addLog('error', '设置开机自启失败: ' + e.message);
  }
}

function toggleAutoLaunch() {
  var current = store.get('autoLaunch');
  var next = !current;
  store.set('autoLaunch', next);
  setAutoLaunch(next);
  broadcastStatus();
}

function applyAutoLaunch() {
  var enabled = store.get('autoLaunch');
  setAutoLaunch(!!enabled);
}

// ─── IPC 处理 ─────────────────────────────────────────────

ipcMain.handle('get-config', function () {
  return store.getAll();
});

ipcMain.handle('save-config', function (_event, config) {
  var needRestart = false;
  var oldConfig = store.getAll();

  if (config.mode !== oldConfig.mode ||
      config.serverUrl !== oldConfig.serverUrl ||
      config.port !== oldConfig.port) {
    needRestart = true;
  }

  store.save(config);

  if (config.autoLaunch !== oldConfig.autoLaunch) {
    setAutoLaunch(!!config.autoLaunch);
  }

  if (needRestart) {
    stopSync();
    startSync();
  }

  broadcastStatus();
  return { ok: true };
});

ipcMain.handle('get-status', function () {
  return {
    connected: engine.connected,
    running: engine.running,
    serverRunning: server.running,
    deviceId: engine.deviceId,
    logs: syncLogs.slice(0, 20)
  };
});

ipcMain.handle('get-history', function () {
  return clipboardHistory.map(function (entry) {
    if (entry.type === 'image') {
      return {
        id: entry.id,
        type: entry.type,
        data: entry.data.substring(0, 200),
        preview: entry.preview,
        direction: entry.direction,
        time: entry.time,
        hasImage: true
      };
    }
    return entry;
  });
});

ipcMain.handle('get-history-image', function (_event, id) {
  for (var i = 0; i < clipboardHistory.length; i++) {
    if (clipboardHistory[i].id === id) {
      if (clipboardHistory[i].data && clipboardHistory[i].data.length > 200) {
        return clipboardHistory[i].data;
      }
    }
  }
  return new Promise(function (resolve) {
    var config = store.getAll();
    var serverUrl = getEffectiveServerUrl(config);
    if (!serverUrl) { resolve(null); return; }
    simpleGet(serverUrl + '/api/history/' + id, function (err, data) {
      if (err || !data || !data.data) { resolve(null); return; }
      for (var j = 0; j < clipboardHistory.length; j++) {
        if (clipboardHistory[j].id === id) {
          clipboardHistory[j].data = data.data;
          break;
        }
      }
      resolve(data.data);
    });
  });
});

ipcMain.handle('copy-history-item', function (_event, id) {
  for (var i = 0; i < clipboardHistory.length; i++) {
    if (clipboardHistory[i].id === id) {
      var entry = clipboardHistory[i];
      if (entry.type === 'image' && electronClipboard) {
        var nativeImage = require('electron').nativeImage;
        var img = nativeImage.createFromBuffer(Buffer.from(entry.data, 'base64'));
        electronClipboard.writeImage(img);
      } else if (electronClipboard) {
        electronClipboard.writeText(entry.data);
      }
      engine.ignoreNextClipboardChange = true;
      return { ok: true };
    }
  }
  return { ok: false };
});

ipcMain.handle('delete-history-item', function (_event, id) {
  for (var i = 0; i < clipboardHistory.length; i++) {
    if (clipboardHistory[i].id === id) {
      clipboardHistory.splice(i, 1);
      skipNextHistoryDeleted = true;
      var config = store.getAll();
      var serverUrl = getEffectiveServerUrl(config);
      if (serverUrl) simpleDelete(serverUrl + '/api/history/' + id, function () {});
      return { ok: true };
    }
  }
  return { ok: false };
});

ipcMain.handle('delete-history-items', function (_event, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false };
  var idSet = {};
  for (var i = 0; i < ids.length; i++) idSet[ids[i]] = true;
  clipboardHistory = clipboardHistory.filter(function (entry) {
    return !idSet[entry.id];
  });
  skipNextHistoryDeleted = true;
  var config = store.getAll();
  var serverUrl = getEffectiveServerUrl(config);
  if (serverUrl) simplePost(serverUrl + '/api/history/batch-delete', { ids: ids }, function () {});
  return { ok: true };
});

ipcMain.handle('toggle-auto-launch', function (_event, enabled) {
  store.set('autoLaunch', enabled);
  setAutoLaunch(enabled);
  broadcastStatus();
  return { autoLaunch: enabled };
});

ipcMain.handle('get-app-version', function () {
  return app.getVersion();
});

ipcMain.handle('check-update', function () {
  return doCheckUpdate(false);
});

ipcMain.handle('open-release-url', function (_event, url) {
  if (url) electron.shell.openExternal(url);
});

// ─── 更新检查 ─────────────────────────────────────────────

function doCheckUpdate(silent) {
  var currentVersion = app.getVersion();
  return new Promise(function (resolve) {
    updater.checkForUpdate(currentVersion, function (err, result) {
      if (err) {
        if (!silent) addLog('error', '检查更新失败: ' + err.message);
        resolve({ hasUpdate: false, error: err.message });
        return;
      }
      if (!result) {
        if (!silent) addLog('info', '当前已是最新版本 v' + currentVersion);
        resolve({ hasUpdate: false, currentVersion: currentVersion });
        return;
      }
      addLog('info', '发现新版本 v' + result.version);
      resolve({
        hasUpdate: true,
        currentVersion: currentVersion,
        latestVersion: result.version,
        notes: result.notes,
        asset: result.asset,
        releaseUrl: result.releaseUrl
      });
    });
  });
}

// ─── 退出 ─────────────────────────────────────────────────

function quitApp() {
  stopSync();
  trayModule.destroyTray();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }
  app.quit();
}

// ─── 应用启动 ─────────────────────────────────────────────

app.whenReady().then(function () {
  store.load();
  applyAutoLaunch();

  trayModule.createTray({
    connected: false,
    autoLaunch: store.get('autoLaunch'),
    onShowWindow: showWindow,
    onToggleAutoLaunch: toggleAutoLaunch,
    onCheckUpdate: function () { doCheckUpdate(false); },
    onQuit: quitApp
  });

  createWindow();
  showWindow();
  startSync();

  setTimeout(function () { doCheckUpdate(true); }, 5000);
});

app.on('window-all-closed', function (e) {
  // 不退出，保持托盘运行
});

app.on('activate', function () {
  showWindow();
});
