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
var electronClipboard = null;
try { electronClipboard = require('electron').clipboard; } catch (_) {}

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
  this.lastImageHash = '';
  this.lastContentType = 'text';
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

  this._readClipboard(function (err, content) {
    if (!err && content) {
      self.lastContentType = content.type;
      self.lastClipboardText = content.type === 'text' ? content.data : '';
      self.lastImageHash = content.hash || '';
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

/**
 * 计算图片数据的快速哈希（用于变化检测，避免比较完整 base64）
 */
SyncEngine.prototype._imageHash = function (nativeImage) {
  if (!nativeImage || nativeImage.isEmpty()) return '';
  var size = nativeImage.getSize();
  var buf = nativeImage.toBitmap();
  var sample = buf.length > 1024 ? buf.slice(0, 512).toString('hex') + buf.slice(-512).toString('hex') : buf.toString('hex');
  return size.width + 'x' + size.height + ':' + crypto.createHash('md5').update(sample).digest('hex');
};

/**
 * 读取剪贴板内容，返回 { type: 'text'|'image', data: string }
 */
SyncEngine.prototype._readClipboard = function (callback) {
  if (electronClipboard) {
    try {
      var img = electronClipboard.readImage();
      if (img && !img.isEmpty()) {
        var hash = this._imageHash(img);
        var base64 = img.toPNG().toString('base64');
        callback(null, { type: 'image', data: base64, hash: hash });
        return;
      }
      var text = electronClipboard.readText() || '';
      callback(null, { type: 'text', data: text, hash: '' });
    } catch (e) {
      callback(e, null);
    }
    return;
  }

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
    if (err) return callback(err, null);
    var text = stdout.replace(/\r\n$/, '').replace(/\n$/, '');
    callback(null, { type: 'text', data: text, hash: '' });
  });

  if (child.stdin) child.stdin.end();
};

/**
 * 写入剪贴板内容
 * @param {string} type - 'text' | 'image'
 * @param {string} data - 文本内容或 base64 PNG
 */
SyncEngine.prototype._writeClipboard = function (type, data, callback) {
  if (electronClipboard) {
    try {
      if (type === 'image') {
        var nativeImage = require('electron').nativeImage;
        var img = nativeImage.createFromBuffer(Buffer.from(data, 'base64'));
        electronClipboard.writeImage(img);
      } else {
        electronClipboard.writeText(data);
      }
      callback(null);
    } catch (e) {
      callback(e);
    }
    return;
  }

  if (type === 'image') {
    callback(new Error('非 Electron 环境不支持图片同步'));
    return;
  }

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

  child.stdin.write(data);
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
  req.setTimeout(30000, function () { req.destroy(new Error('请求超时')); });

  if (postData) req.write(postData);
  req.end();
};

// ─── 核心循环 ──────────────────────────────────────────────

SyncEngine.prototype._pollClipboard = function () {
  var self = this;
  if (!self.running) return;

  self._readClipboard(function (err, content) {
    if (!self.running) return;

    if (!err && content) {
      if (self.ignoreNextClipboardChange) {
        self.ignoreNextClipboardChange = false;
        self.lastContentType = content.type;
        self.lastClipboardText = content.type === 'text' ? content.data : '';
        self.lastImageHash = content.hash || '';
      } else {
        var changed = false;
        if (content.type === 'image') {
          changed = content.hash !== self.lastImageHash;
        } else {
          changed = content.data !== self.lastClipboardText;
        }
        if (changed) {
          self.lastContentType = content.type;
          self.lastClipboardText = content.type === 'text' ? content.data : '';
          self.lastImageHash = content.hash || '';
          self._pushToServer(content.type, content.data);
        }
      }
    }

    self._clipboardTimer = setTimeout(function () {
      self._pollClipboard();
    }, CLIPBOARD_POLL_MS);
  });
};

SyncEngine.prototype._formatSize = function (bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / 1024 / 1024).toFixed(1) + 'MB';
};

SyncEngine.prototype._pushToServer = function (type, data) {
  var self = this;
  var pushUrl = self.serverUrl + '/api/sync';
  var sizeBytes = Buffer.byteLength(data, 'utf8');
  var sizeStr = self._formatSize(sizeBytes);

  if (type === 'image') {
    self.emit('pushing', '正在推送图片 (' + sizeStr + ')...');
  }

  self._httpRequest('POST', pushUrl, { type: type, data: data, deviceId: self.deviceId }, function (err, respData) {
    if (err) {
      self.emit('error', err);
      return;
    }
    if (respData && typeof respData.version === 'number') {
      self.knownVersion = respData.version;
    }
    if (!self.connected) {
      self.connected = true;
      self.emit('connected');
    }
    var label = type === 'image' ? '[图片 ' + sizeStr + ']' : data;
    if (type === 'image') self._lastPushedImageData = data;
    self.emit('pushed', label);
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

    if (data.lastUpdater === self.deviceId) {
      self._serverTimer = setTimeout(function () { self._pollServer(); }, SERVER_POLL_MS);
      return;
    }

    var type = data.type || 'text';
    var content = data.data !== undefined ? data.data : data.text;

    if (type === 'text' && content === self.lastClipboardText) {
      self._serverTimer = setTimeout(function () { self._pollServer(); }, SERVER_POLL_MS);
      return;
    }

    self.ignoreNextClipboardChange = true;
    if (type === 'text') {
      self.lastClipboardText = content;
      self.lastImageHash = '';
    } else {
      self.lastClipboardText = '';
      self.lastImageHash = crypto.createHash('md5').update(content.slice(0, 1024)).digest('hex');
    }
    self.lastContentType = type;

    var sizeStr = self._formatSize(Buffer.byteLength(content, 'utf8'));
    var label = type === 'image' ? '[图片 ' + sizeStr + ']' : content;

    if (type === 'image') {
      self.emit('syncing', '正在接收图片 (' + sizeStr + ')...');
    }

    if (type === 'image') self._lastSyncedImageData = content;
    self._writeClipboard(type, content, function (writeErr) {
      if (writeErr) {
        self.ignoreNextClipboardChange = false;
        self.emit('error', writeErr);
      } else {
        self.emit('synced', label);
      }
      self._serverTimer = setTimeout(function () { self._pollServer(); }, SERVER_POLL_MS);
    });
  });
};

module.exports = SyncEngine;
