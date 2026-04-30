/**
 * 可启停的内嵌服务端 — 从 server.js 提取
 *
 * 用法:
 *   var EmbeddedServer = require('./server-embed');
 *   var srv = new EmbeddedServer();
 *   srv.start(3846, function (err) { ... });
 *   srv.stop(function () { ... });
 */
var express = require('express');
var path = require('path');
var os = require('os');
var fs = require('fs');

function EmbeddedServer() {
  this._server = null;
  this._port = 3846;
  this.running = false;
}

/**
 * 获取本机局域网 IPv4 地址列表（排除回环）
 */
function getLocalIPv4List() {
  var list = [];
  var interfaces = os.networkInterfaces();
  var name;
  for (name in interfaces) {
    if (!Object.prototype.hasOwnProperty.call(interfaces, name)) continue;
    var addrs = interfaces[name];
    for (var i = 0; i < addrs.length; i++) {
      var addr = addrs[i];
      if (addr.family === 'IPv4' && addr.address !== '127.0.0.1') {
        list.push(addr.address);
      }
    }
  }
  return list;
}

/**
 * 启动服务端
 * @param {number} port
 * @param {function(Error|null)} callback
 */
EmbeddedServer.prototype.start = function (port, callback) {
  var self = this;
  self._port = port || 3846;

  var app = express();

  var sharedContent = { text: '', images: [], files: [] };
  var syncState = { type: 'text', data: '', version: 0, lastUpdater: '', deleteVersion: 0 };

  var MAX_HISTORY = 100;
  var historyData = [];
  var historyFile = path.join(os.homedir(), '.clipboard-share', 'server-history.json');

  function loadServerHistory() {
    try {
      if (fs.existsSync(historyFile)) {
        var raw = fs.readFileSync(historyFile, 'utf8');
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) historyData = parsed.slice(0, MAX_HISTORY);
      }
    } catch (e) { historyData = []; }
  }

  function saveServerHistory() {
    try {
      var dir = path.dirname(historyFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(historyFile, JSON.stringify(historyData), 'utf8');
    } catch (e) {}
  }

  loadServerHistory();

  function updateSyncFromShared(text, updater) {
    if (syncState.type === 'text' && syncState.data === text) return;
    syncState.type = 'text';
    syncState.data = text;
    syncState.version += 1;
    syncState.lastUpdater = updater || 'web';
  }

  app.use(express.json({ limit: '50mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/api/host', function (req, res) {
    var ips = getLocalIPv4List();
    var urls = ips.map(function (ip) { return 'http://' + ip + ':' + self._port; });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({ ips: ips, port: self._port, urls: urls });
  });

  app.get('/api/text', function (req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({ text: sharedContent.text });
  });

  app.post('/api/text', function (req, res) {
    var body = req.body;
    if (body && typeof body.text === 'string') {
      sharedContent.text = body.text;
      updateSyncFromShared(body.text);
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({ ok: true, text: sharedContent.text });
  });

  app.get('/api/content', function (req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({ text: sharedContent.text, images: sharedContent.images, files: sharedContent.files });
  });

  app.post('/api/content', function (req, res) {
    var body = req.body;
    if (body) {
      if (typeof body.text === 'string') {
        sharedContent.text = body.text;
        updateSyncFromShared(body.text);
      }
      if (Array.isArray(body.images)) sharedContent.images = body.images;
      if (Array.isArray(body.files)) sharedContent.files = body.files;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({ ok: true, text: sharedContent.text, images: sharedContent.images, files: sharedContent.files });
  });

  app.get('/api/sync', function (req, res) {
    var since = parseInt(req.query.since, 10);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (!isNaN(since) && since >= syncState.version) {
      res.json({ changed: false, version: syncState.version, deleteVersion: syncState.deleteVersion });
      return;
    }
    res.json({
      changed: true,
      type: syncState.type,
      data: syncState.data,
      text: syncState.type === 'text' ? syncState.data : '',
      version: syncState.version,
      lastUpdater: syncState.lastUpdater,
      deleteVersion: syncState.deleteVersion
    });
  });

  app.post('/api/sync', function (req, res) {
    var body = req.body;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (!body || typeof body.deviceId !== 'string') {
      res.status(400).json({ ok: false, error: 'deviceId 为必填字段' });
      return;
    }
    var type = body.type || 'text';
    var data = body.data !== undefined ? body.data : body.text;
    if (data === undefined || data === null) {
      res.status(400).json({ ok: false, error: '缺少 data 或 text 字段' });
      return;
    }
    if (syncState.type !== type || syncState.data !== data) {
      syncState.type = type;
      syncState.data = data;
      syncState.version += 1;
      syncState.lastUpdater = body.deviceId;
      if (type === 'text') sharedContent.text = data;
      historyData.unshift({
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        type: type,
        data: data,
        direction: body.deviceId,
        time: new Date().toISOString(),
        preview: type === 'image' ? '[图片]' : (data.length > 200 ? data.substring(0, 200) : data)
      });
      if (historyData.length > MAX_HISTORY) historyData.pop();
      saveServerHistory();
    }
    res.json({ ok: true, version: syncState.version });
  });

  app.get('/api/history', function (req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json(historyData.map(function (entry) {
      if (entry.type === 'image') {
        return {
          id: entry.id, type: entry.type,
          data: entry.data.substring(0, 200),
          preview: entry.preview, direction: entry.direction,
          time: entry.time, hasImage: true
        };
      }
      return entry;
    }));
  });

  app.get('/api/history/:id', function (req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    for (var i = 0; i < historyData.length; i++) {
      if (historyData[i].id === req.params.id) {
        res.json({ data: historyData[i].data });
        return;
      }
    }
    res.status(404).json({ error: 'not found' });
  });

  app.delete('/api/history/:id', function (req, res) {
    for (var i = 0; i < historyData.length; i++) {
      if (historyData[i].id === req.params.id) {
        historyData.splice(i, 1);
        saveServerHistory();
        syncState.deleteVersion += 1;
        res.json({ ok: true });
        return;
      }
    }
    res.status(404).json({ error: 'not found' });
  });

  app.post('/api/history/batch-delete', function (req, res) {
    var ids = req.body && req.body.ids;
    if (!Array.isArray(ids)) {
      res.status(400).json({ error: 'ids must be an array' });
      return;
    }
    var idSet = {};
    for (var k = 0; k < ids.length; k++) idSet[ids[k]] = true;
    var before = historyData.length;
    historyData = historyData.filter(function (entry) { return !idSet[entry.id]; });
    if (historyData.length < before) {
      saveServerHistory();
      syncState.deleteVersion += 1;
    }
    res.json({ ok: true, deleted: before - historyData.length });
  });

  app.get('/', function (req, res) {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  self._server = app.listen(self._port, '0.0.0.0', function () {
    self.running = true;
    callback(null);
  });

  self._server.on('error', function (err) {
    if (err.code === 'EADDRINUSE') {
      self.running = false;
      callback(new Error('端口 ' + self._port + ' 已被占用'));
      return;
    }
    callback(err);
  });
};

/**
 * 停止服务端
 * @param {function()} [callback]
 */
EmbeddedServer.prototype.stop = function (callback) {
  var self = this;
  if (self._server) {
    self._server.close(function () {
      self.running = false;
      self._server = null;
      if (callback) callback();
    });
  } else {
    self.running = false;
    if (callback) callback();
  }
};

module.exports = EmbeddedServer;
