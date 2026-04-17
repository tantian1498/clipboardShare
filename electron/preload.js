/**
 * Preload 脚本 — 安全地暴露 IPC 接口给渲染进程
 */
var electron = require('electron');
var contextBridge = electron.contextBridge;
var ipcRenderer = electron.ipcRenderer;

contextBridge.exposeInMainWorld('clipboardAPI', {
  getConfig: function () {
    return ipcRenderer.invoke('get-config');
  },
  saveConfig: function (config) {
    return ipcRenderer.invoke('save-config', config);
  },
  getStatus: function () {
    return ipcRenderer.invoke('get-status');
  },
  onStatusChange: function (callback) {
    ipcRenderer.on('status-changed', function (_event, status) {
      callback(status);
    });
  },
  onSyncLog: function (callback) {
    ipcRenderer.on('sync-log', function (_event, log) {
      callback(log);
    });
  },
  toggleAutoLaunch: function (enabled) {
    return ipcRenderer.invoke('toggle-auto-launch', enabled);
  },
  checkUpdate: function () {
    return ipcRenderer.invoke('check-update');
  },
  openReleaseUrl: function (url) {
    return ipcRenderer.invoke('open-release-url', url);
  },
  getAppVersion: function () {
    return ipcRenderer.invoke('get-app-version');
  },
  getHistory: function () {
    return ipcRenderer.invoke('get-history');
  },
  getHistoryImage: function (id) {
    return ipcRenderer.invoke('get-history-image', id);
  },
  copyHistoryItem: function (id) {
    return ipcRenderer.invoke('copy-history-item', id);
  },
  deleteHistoryItem: function (id) {
    return ipcRenderer.invoke('delete-history-item', id);
  },
  onHistoryUpdate: function (callback) {
    ipcRenderer.on('history-update', function (_event, entry) {
      callback(entry);
    });
  }
});
