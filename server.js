/**
 * 跨电脑剪贴板共享 - 服务端
 * 监听 0.0.0.0 以便局域网内其它电脑通过本机 IP:端口 访问
 */
var express = require('express');
var path = require('path');
var os = require('os');
var fs = require('fs');

var app = express();
var PORT = process.env.PORT || 3846;

// 内存中保存的共享内容：文本 + 图片 + 文件（均在内存中）
var sharedContent = {
  text: '',
  images: [],
  files: []
};

// Agent 同步状态：版本号递增，lastUpdater 记录最后更新的设备 ID
var syncState = {
  type: 'text',   // 'text' | 'image'
  data: '',        // text: 文本内容; image: base64 PNG
  version: 0,
  lastUpdater: '',
  deleteVersion: 0
};

// ─── 历史记录持久化 ────────────────────────────────────────────
var MAX_HISTORY = 100;
var historyData = [];
var historyFile = path.join(__dirname, 'history.json');

function loadHistory() {
  try {
    if (fs.existsSync(historyFile)) {
      var raw = fs.readFileSync(historyFile, 'utf8');
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) historyData = parsed.slice(0, MAX_HISTORY);
    }
  } catch (e) { historyData = []; }
}

function saveHistory() {
  try {
    fs.writeFileSync(historyFile, JSON.stringify(historyData), 'utf8');
  } catch (e) {}
}

loadHistory();

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

// 解析 JSON 请求体（图片/文件 base64 较大，放宽限制）
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/**
 * 当文本通过网页端变更时，同步更新 syncState
 */
function updateSyncFromShared(text, updater) {
  if (syncState.type === 'text' && syncState.data === text) return;
  syncState.type = 'text';
  syncState.data = text;
  syncState.version += 1;
  syncState.lastUpdater = updater || 'web';
}

// 获取本机 IP 与访问地址（供网页展示）
app.get('/api/host', function (req, res) {
  var ips = getLocalIPv4List();
  var port = PORT;
  var urls = ips.map(function (ip) {
    return 'http://' + ip + ':' + port;
  });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json({ ips: ips, port: port, urls: urls });
});

// 获取当前共享文本（兼容旧前端）
app.get('/api/text', function (req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json({ text: sharedContent.text });
});

// 更新共享文本（兼容旧前端）
app.post('/api/text', function (req, res) {
  var body = req.body;
  if (body && typeof body.text === 'string') {
    sharedContent.text = body.text;
    updateSyncFromShared(body.text);
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json({ ok: true, text: sharedContent.text });
});

// 获取完整共享内容（文本 + 图片 + 文件）
app.get('/api/content', function (req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json({
    text: sharedContent.text,
    images: sharedContent.images,
    files: sharedContent.files
  });
});

// 更新完整共享内容（文本 + 图片 + 文件）
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
  res.json({
    ok: true,
    text: sharedContent.text,
    images: sharedContent.images,
    files: sharedContent.files
  });
});

// Agent 同步：获取最新内容（支持 ?since=<version> 减少无效传输）
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

// Agent 同步：推送新内容（支持 text / image）
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
    if (type === 'text') {
      sharedContent.text = data;
    }
    historyData.unshift({
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      type: type,
      data: data,
      direction: body.deviceId,
      time: new Date().toISOString(),
      preview: type === 'image' ? '[图片]' : (data.length > 200 ? data.substring(0, 200) : data)
    });
    if (historyData.length > MAX_HISTORY) historyData.pop();
    saveHistory();
  }
  res.json({ ok: true, version: syncState.version });
});

// Agent 同步：获取历史记录
app.get('/api/history', function (req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(historyData.map(function (entry) {
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
  }));
});

// Agent 同步：获取历史图片完整数据
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

// Agent 同步：批量删除历史记录
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
    saveHistory();
    syncState.deleteVersion += 1;
  }
  res.json({ ok: true, deleted: before - historyData.length });
});

// Agent 同步：删除历史记录
app.delete('/api/history/:id', function (req, res) {
  for (var i = 0; i < historyData.length; i++) {
    if (historyData[i].id === req.params.id) {
      historyData.splice(i, 1);
      saveHistory();
      syncState.deleteVersion += 1;
      res.json({ ok: true });
      return;
    }
  }
  res.status(404).json({ error: 'not found' });
});

// 前端页面
app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

var server = app.listen(PORT, '0.0.0.0', function () {
  console.log('剪贴板共享服务已启动');
  console.log('本机访问: http://localhost:' + PORT);
  console.log('其它电脑访问: http://<本机IP>:' + PORT);
});

server.on('error', function (err) {
  if (err.code === 'EADDRINUSE') {
    console.log('端口 ' + PORT + ' 已被占用，跳过服务端启动（将连接已有服务）');
    return;
  }
  throw err;
});
