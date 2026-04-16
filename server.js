/**
 * 跨电脑剪贴板共享 - 服务端
 * 监听 0.0.0.0 以便局域网内其它电脑通过本机 IP:端口 访问
 */
var express = require('express');
var path = require('path');
var os = require('os');

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
  text: '',
  version: 0,
  lastUpdater: ''
};

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
 * 当文本通过任意渠道变更时，同步更新 syncState（网页端 → Agent 可见）
 * @param {string} text - 新文本
 * @param {string} [updater] - 更新者设备 ID，网页端留空用 'web'
 */
function updateSyncFromShared(text, updater) {
  if (syncState.text === text) return;
  syncState.text = text;
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
    res.json({ changed: false, version: syncState.version });
    return;
  }
  res.json({
    changed: true,
    text: syncState.text,
    version: syncState.version,
    lastUpdater: syncState.lastUpdater
  });
});

// Agent 同步：推送新内容
app.post('/api/sync', function (req, res) {
  var body = req.body;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!body || typeof body.text !== 'string' || typeof body.deviceId !== 'string') {
    res.status(400).json({ ok: false, error: 'text 和 deviceId 为必填字段' });
    return;
  }
  if (syncState.text !== body.text) {
    syncState.text = body.text;
    syncState.version += 1;
    syncState.lastUpdater = body.deviceId;
    sharedContent.text = body.text;
  }
  res.json({ ok: true, version: syncState.version });
});

// 前端页面
app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', function () {
  console.log('剪贴板共享服务已启动');
  console.log('本机访问: http://localhost:' + PORT);
  console.log('其它电脑访问: http://<本机IP>:' + PORT);
});
