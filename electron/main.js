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

var trayModule = require('./tray');
var SyncEngine = require('./sync-engine');
var EmbeddedServer = require('./server-embed');
var Store = require('./store');

var mainWindow = null;
var engine = new SyncEngine();
var server = new EmbeddedServer();
var store = new Store();
var syncLogs = [];
var MAX_LOGS = 50;

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
    mainWindow.webContents.send('sync-log', entry);
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
    deviceId: engine.deviceId
  };
  trayModule.updateMenu({
    connected: engine.connected,
    autoLaunch: store.get('autoLaunch'),
    onShowWindow: showWindow,
    onToggleAutoLaunch: toggleAutoLaunch,
    onQuit: quitApp
  });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status-changed', status);
  }
}

// ─── 同步引擎事件 ─────────────────────────────────────────

engine.on('connected', function () {
  addLog('info', '已连接到服务器');
  broadcastStatus();
});

engine.on('disconnected', function () {
  addLog('info', '与服务器断开连接');
  broadcastStatus();
});

engine.on('pushed', function (text) {
  addLog('push', text);
});

engine.on('synced', function (text) {
  addLog('sync', text);
});

engine.on('error', function (err) {
  addLog('error', err.message || '未知错误');
});

// ─── 窗口管理 ─────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 560,
    resizable: false,
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

function toggleAutoLaunch() {
  var current = store.get('autoLaunch');
  var next = !current;
  store.set('autoLaunch', next);
  app.setLoginItemSettings({ openAtLogin: next });
  broadcastStatus();
}

function applyAutoLaunch() {
  var enabled = store.get('autoLaunch');
  app.setLoginItemSettings({ openAtLogin: !!enabled });
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
    app.setLoginItemSettings({ openAtLogin: !!config.autoLaunch });
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
    onQuit: quitApp
  });

  createWindow();
  showWindow();
  startSync();
});

app.on('window-all-closed', function (e) {
  // 不退出，保持托盘运行
});

app.on('activate', function () {
  showWindow();
});
