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
  }
});
