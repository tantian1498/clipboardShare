/**
 * 剪贴板同步引擎 — 从 agent.js 提取的核心逻辑
 *
 * 封装为 EventEmitter，支持 start / stop 控制。
 * 事件: pushed, synced, error, connected, disconnected
 */
var EventEmitter = require('events').EventEmitter;
var http = require('http');
var crypto = require('crypto');
var childProcess = require('child_process');
var os = require('os');
var util = require('util');

var CLIPBOARD_POLL_MS = 500;
var SERVER_POLL_MS = 1000;

function SyncEngine() {
  EventEmitter.call(this);

  this.platform = os.platform();
  this.deviceId = this.platform + '-' + crypto.randomBytes(4).toString('hex');
  this.serverUrl = '';
  this.running = false;
  this.connected = false;
  this.knownVersion = 0;
  this.lastClipboardText = '';
  this.ignoreNextClipboardChange = false;
  this._clipboardTimer = null;
  this._serverTimer = null;
}

util.inherits(SyncEngine, EventEmitter);

// ─── 公共 API ─────────────────────────────────────────────

SyncEngine.prototype.start = function (serverUrl) {
  if (!serverUrl) {
    this.emit('error', new Error('服务器地址为空'));
    return;
  }
  if (this.running) this.stop();
  this.serverUrl = serverUrl.replace(/\/+$/, '');
  this.running = true;
  this.knownVersion = 0;
  this.connected = false;

  var self = this;

  this._readClipboard(function (err, text) {
    if (!err) {
      self.lastClipboardText = text;
    }
    self._httpRequest('GET', self.serverUrl + '/api/sync', null, function (syncErr, data) {
      if (!self.running) return;
      if (!syncErr && data && typeof data.version === 'number') {
        self.knownVersion = data.version;
        self.connected = true;
        self.emit('connected');
      } else {
        self.emit('disconnected');
      }
      self._pollClipboard();
      self._pollServer();
    });
  });
};

SyncEngine.prototype.stop = function () {
  this.running = false;
  if (this._clipboardTimer) {
    clearTimeout(this._clipboardTimer);
    this._clipboardTimer = null;
  }
  if (this._serverTimer) {
    clearTimeout(this._serverTimer);
    this._serverTimer = null;
  }
};

// ─── 剪贴板操作 ───────────────────────────────────────────

SyncEngine.prototype._readClipboard = function (callback) {
  var cmd, cmdArgs;
  if (this.platform === 'darwin') {
    cmd = 'pbpaste';
    cmdArgs = [];
  } else if (this.platform === 'win32') {
    cmd = 'powershell';
    cmdArgs = [
      '-NoProfile', '-Command',
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard'
    ];
  } else {
    cmd = 'xclip';
    cmdArgs = ['-selection', 'clipboard', '-o'];
  }

  var child = childProcess.execFile(cmd, cmdArgs, { encoding: 'utf8', timeout: 3000 }, function (err, stdout) {
    if (err) return callback(err, '');
    var text = stdout.replace(/\r\n$/, '').replace(/\n$/, '');
    callback(null, text);
  });

  if (child.stdin) child.stdin.end();
};

SyncEngine.prototype._writeClipboard = function (text, callback) {
  var cmd, cmdArgs;
  if (this.platform === 'darwin') {
    cmd = 'pbcopy';
    cmdArgs = [];
  } else if (this.platform === 'win32') {
    cmd = 'powershell';
    cmdArgs = [
      '-NoProfile', '-Command',
      '[Console]::InputEncoding = [System.Text.Encoding]::UTF8; $input | Set-Clipboard'
    ];
  } else {
    cmd = 'xclip';
    cmdArgs = ['-selection', 'clipboard'];
  }

  var child = childProcess.execFile(cmd, cmdArgs, { encoding: 'utf8', timeout: 3000 }, function (err) {
    callback(err || null);
  });

  child.stdin.write(text);
  child.stdin.end();
};

// ─── HTTP ─────────────────────────────────────────────────

SyncEngine.prototype._httpRequest = function (method, reqUrl, body, callback) {
  var parsed;
  try {
    parsed = new URL(reqUrl);
  } catch (e) {
    callback(new Error('无效的 URL: ' + reqUrl), null);
    return;
  }
  var postData = body ? JSON.stringify(body) : null;

  var opts = {
    hostname: parsed.hostname,
    port: parsed.port || 80,
    path: parsed.pathname + parsed.search,
    method: method,
    headers: {}
  };

  if (postData) {
    opts.headers['Content-Type'] = 'application/json; charset=utf-8';
    opts.headers['Content-Length'] = Buffer.byteLength(postData);
  }

  var req = http.request(opts, function (res) {
    var chunks = [];
    res.setEncoding('utf8');
    res.on('data', function (chunk) { chunks.push(chunk); });
    res.on('end', function () {
      var raw = chunks.join('');
      try {
        callback(null, JSON.parse(raw));
      } catch (e) {
        callback(new Error('JSON 解析失败'), null);
      }
    });
  });

  req.on('error', function (err) { callback(err, null); });
  req.setTimeout(5000, function () { req.destroy(new Error('请求超时')); });

  if (postData) req.write(postData);
  req.end();
};

// ─── 核心循环 ──────────────────────────────────────────────

SyncEngine.prototype._pollClipboard = function () {
  var self = this;
  if (!self.running) return;

  self._readClipboard(function (err, text) {
    if (!self.running) return;

    if (!err) {
      if (self.ignoreNextClipboardChange) {
        self.ignoreNextClipboardChange = false;
        self.lastClipboardText = text;
      } else if (text !== self.lastClipboardText) {
        self.lastClipboardText = text;
        self._pushToServer(text);
      }
    }

    self._clipboardTimer = setTimeout(function () {
      self._pollClipboard();
    }, CLIPBOARD_POLL_MS);
  });
};

SyncEngine.prototype._pushToServer = function (text) {
  var self = this;
  var pushUrl = self.serverUrl + '/api/sync';
  self._httpRequest('POST', pushUrl, { text: text, deviceId: self.deviceId }, function (err, data) {
    if (err) {
      self.emit('error', err);
      return;
    }
    if (data && typeof data.version === 'number') {
      self.knownVersion = data.version;
    }
    if (!self.connected) {
      self.connected = true;
      self.emit('connected');
    }
    self.emit('pushed', text);
  });
};

SyncEngine.prototype._pollServer = function () {
  var self = this;
  if (!self.running) return;

  var syncUrl = self.serverUrl + '/api/sync?since=' + self.knownVersion;
  self._httpRequest('GET', syncUrl, null, function (err, data) {
    if (!self.running) return;

    if (err) {
      if (self.connected) {
        self.connected = false;
        self.emit('disconnected');
      }
      self._serverTimer = setTimeout(function () { self._pollServer(); }, SERVER_POLL_MS);
      return;
    }

    if (!self.connected) {
      self.connected = true;
      self.emit('connected');
    }

    if (!data || !data.changed) {
      self._serverTimer = setTimeout(function () { self._pollServer(); }, SERVER_POLL_MS);
      return;
    }

    self.knownVersion = data.version;

    if (data.lastUpdater === self.deviceId || data.text === self.lastClipboardText) {
      self._serverTimer = setTimeout(function () { self._pollServer(); }, SERVER_POLL_MS);
      return;
    }

    self.ignoreNextClipboardChange = true;
    self.lastClipboardText = data.text;

    self._writeClipboard(data.text, function (writeErr) {
      if (writeErr) {
        self.ignoreNextClipboardChange = false;
        self.emit('error', writeErr);
      } else {
        self.emit('synced', data.text);
      }
      self._serverTimer = setTimeout(function () { self._pollServer(); }, SERVER_POLL_MS);
    });
  });
};

module.exports = SyncEngine;
