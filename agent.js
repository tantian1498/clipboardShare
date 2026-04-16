/**
 * 跨平台剪贴板同步 Agent
 *
 * 在两端各运行一个实例，自动监听本地剪贴板变化并上传到服务器，
 * 同时轮询服务器获取另一端的新内容并写入本地剪贴板。
 *
 * 用法：
 *   node agent.js --server http://<服务器IP>:3846           # 连接远程服务器
 *   node agent.js --host                                    # 本机同时启动服务端 + Agent
 *   node agent.js --host --install                          # 注册开机自启（服务端 + Agent）
 *   node agent.js --server http://<服务器IP>:3846 --install  # 注册开机自启（仅 Agent）
 *   node agent.js --uninstall                                # 卸载开机自启
 *
 * 零外部依赖，仅使用 Node.js 内置模块。
 */
var http = require('http');
var url = require('url');
var crypto = require('crypto');
var childProcess = require('child_process');
var fs = require('fs');
var path = require('path');
var os = require('os');

// ─── 参数解析 ──────────────────────────────────────────────

var args = process.argv.slice(2);
var serverUrl = '';
var wantInstall = false;
var wantUninstall = false;
var wantHost = false;

for (var i = 0; i < args.length; i++) {
  if (args[i] === '--server' && args[i + 1]) {
    serverUrl = args[i + 1].replace(/\/+$/, '');
    i++;
  } else if (args[i] === '--install') {
    wantInstall = true;
  } else if (args[i] === '--uninstall') {
    wantUninstall = true;
  } else if (args[i] === '--host') {
    wantHost = true;
  }
}

// ─── 开机自启：安装 / 卸载 ────────────────────────────────

var SERVICE_LABEL = 'com.clipboard-share.agent';
var platform = os.platform();

function getMacPlistPath() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', SERVICE_LABEL + '.plist');
}

function getWinVbsPath() {
  var startupDir = path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'
  );
  return path.join(startupDir, 'clipboard-share-agent.vbs');
}

/**
 * 构建 LaunchAgent 中 ProgramArguments 的 XML 片段
 */
function buildPlistArgs(nodePath, agentPath) {
  var lines = [
    '    <string>' + nodePath + '</string>',
    '    <string>' + agentPath + '</string>'
  ];
  if (wantHost) {
    lines.push('    <string>--host</string>');
  } else {
    lines.push('    <string>--server</string>');
    lines.push('    <string>' + serverUrl + '</string>');
  }
  return lines;
}

function installMac() {
  var nodePath = process.execPath;
  var agentPath = path.resolve(__filename);
  var logPath = path.join(os.tmpdir(), 'clipboard-share-agent.log');
  var plistPath = getMacPlistPath();

  var plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"',
    '  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    '  <string>' + SERVICE_LABEL + '</string>',
    '  <key>ProgramArguments</key>',
    '  <array>'
  ]
    .concat(buildPlistArgs(nodePath, agentPath))
    .concat([
    '  </array>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <true/>',
    '  <key>StandardOutPath</key>',
    '  <string>' + logPath + '</string>',
    '  <key>StandardErrorPath</key>',
    '  <string>' + logPath + '</string>',
    '</dict>',
    '</plist>'
  ]).join('\n');

  var launchAgentsDir = path.dirname(plistPath);
  if (!fs.existsSync(launchAgentsDir)) {
    fs.mkdirSync(launchAgentsDir, { recursive: true });
  }

  fs.writeFileSync(plistPath, plist, 'utf8');
  childProcess.execSync('launchctl load -w "' + plistPath + '"');
  console.log('已注册开机自启 (macOS LaunchAgent)');
  console.log('  plist: ' + plistPath);
  console.log('  日志:  ' + logPath);
  console.log('  模式: ' + (wantHost ? '服务端 + Agent' : '仅 Agent'));
  if (!wantHost) console.log('  服务器: ' + serverUrl);
  console.log('\n服务已立即启动，无需重启电脑。');
  console.log('卸载: node agent.js --uninstall');
}

function uninstallMac() {
  var plistPath = getMacPlistPath();
  if (fs.existsSync(plistPath)) {
    try { childProcess.execSync('launchctl unload "' + plistPath + '"'); } catch (e) { /* 可能未加载 */ }
    fs.unlinkSync(plistPath);
    console.log('已卸载开机自启 (macOS LaunchAgent)');
  } else {
    console.log('未找到已安装的服务，无需卸载');
  }
}

function installWin() {
  var nodePath = process.execPath;
  var agentPath = path.resolve(__filename);
  var vbsPath = getWinVbsPath();

  var runArgs = wantHost
    ? ' --host'
    : ' --server ' + serverUrl;

  var vbs = [
    'Set WshShell = CreateObject("WScript.Shell")',
    'WshShell.Run """' + nodePath + '""' +
      ' ""' + agentPath + '""' + runArgs + '", 0, False'
  ].join('\r\n');

  fs.writeFileSync(vbsPath, vbs, 'utf8');
  console.log('已注册开机自启 (Windows 启动文件夹)');
  console.log('  脚本: ' + vbsPath);
  console.log('  模式: ' + (wantHost ? '服务端 + Agent' : '仅 Agent'));
  if (!wantHost) console.log('  服务器: ' + serverUrl);
  console.log('\n下次登录 Windows 时将自动启动。');
  console.log('卸载: node agent.js --uninstall');
}

function uninstallWin() {
  var vbsPath = getWinVbsPath();
  if (fs.existsSync(vbsPath)) {
    fs.unlinkSync(vbsPath);
    console.log('已卸载开机自启 (Windows 启动文件夹)');
  } else {
    console.log('未找到已安装的启动脚本，无需卸载');
  }
}

if (wantUninstall) {
  if (platform === 'darwin') { uninstallMac(); }
  else if (platform === 'win32') { uninstallWin(); }
  else { console.log('当前平台 (' + platform + ') 暂不支持自动卸载'); }
  process.exit(0);
}

if (wantInstall) {
  if (!serverUrl && !wantHost) {
    console.error('安装需要指定服务器或使用 --host 模式:');
    console.error('  node agent.js --server http://<IP>:3846 --install');
    console.error('  node agent.js --host --install');
    process.exit(1);
  }
  if (platform === 'darwin') { installMac(); }
  else if (platform === 'win32') { installWin(); }
  else { console.log('当前平台 (' + platform + ') 暂不支持自动安装，请手动配置开机自启'); }
  process.exit(0);
}

// --host 模式：在同一进程中启动服务端，serverUrl 指向 localhost
if (wantHost) {
  var HOST_PORT = process.env.PORT || 3846;
  serverUrl = 'http://localhost:' + HOST_PORT;
  require('./server.js');
}

if (!serverUrl) {
  console.error('用法: node agent.js --server http://<服务器IP>:3846');
  console.error('      node agent.js --host');
  console.error('      node agent.js --host --install');
  console.error('      node agent.js --uninstall');
  process.exit(1);
}

// ─── 常量 ──────────────────────────────────────────────────

var CLIPBOARD_POLL_MS = 500;
var SERVER_POLL_MS = 1000;
var deviceId = platform + '-' + crypto.randomBytes(4).toString('hex');

// ─── 状态 ──────────────────────────────────────────────────

var knownVersion = 0;
var lastClipboardText = '';
var ignoreNextClipboardChange = false;

// ─── 跨平台剪贴板操作 ─────────────────────────────────────

/**
 * 读取系统剪贴板文本内容
 * @param {function(Error|null, string)} callback
 */
function readClipboard(callback) {
  var cmd, cmdArgs;
  if (platform === 'darwin') {
    cmd = 'pbpaste';
    cmdArgs = [];
  } else if (platform === 'win32') {
    cmd = 'powershell';
    cmdArgs = ['-NoProfile', '-Command', 'Get-Clipboard'];
  } else {
    cmd = 'xclip';
    cmdArgs = ['-selection', 'clipboard', '-o'];
  }

  var child = childProcess.execFile(cmd, cmdArgs, { encoding: 'utf8', timeout: 3000 }, function (err, stdout) {
    if (err) {
      callback(err, '');
      return;
    }
    // Windows PowerShell 输出末尾会有 \r\n，统一去掉尾部换行
    var text = stdout.replace(/\r\n$/, '').replace(/\n$/, '');
    callback(null, text);
  });

  // 避免子进程因无 stdin 挂起
  if (child.stdin) {
    child.stdin.end();
  }
}

/**
 * 将文本写入系统剪贴板
 * @param {string} text
 * @param {function(Error|null)} callback
 */
function writeClipboard(text, callback) {
  var cmd, cmdArgs;
  if (platform === 'darwin') {
    cmd = 'pbcopy';
    cmdArgs = [];
  } else if (platform === 'win32') {
    cmd = 'powershell';
    cmdArgs = ['-NoProfile', '-Command', 'Set-Clipboard -Value $input'];
  } else {
    cmd = 'xclip';
    cmdArgs = ['-selection', 'clipboard'];
  }

  var child = childProcess.execFile(cmd, cmdArgs, { encoding: 'utf8', timeout: 3000 }, function (err) {
    callback(err || null);
  });

  child.stdin.write(text);
  child.stdin.end();
}

// ─── HTTP 工具 ─────────────────────────────────────────────

/**
 * 发送 HTTP 请求（仅支持 http://）
 * @param {string} method - GET / POST
 * @param {string} reqUrl - 完整 URL
 * @param {object|null} body - POST 时的 JSON body
 * @param {function(Error|null, object)} callback
 */
function httpRequest(method, reqUrl, body, callback) {
  var parsed = url.parse(reqUrl);
  var postData = body ? JSON.stringify(body) : null;

  var opts = {
    hostname: parsed.hostname,
    port: parsed.port || 80,
    path: parsed.path,
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
        callback(new Error('JSON 解析失败: ' + raw), null);
      }
    });
  });

  req.on('error', function (err) { callback(err, null); });
  req.setTimeout(5000, function () { req.destroy(new Error('请求超时')); });

  if (postData) {
    req.write(postData);
  }
  req.end();
}

// ─── 核心循环 ──────────────────────────────────────────────

/**
 * 监听本地剪贴板变化，有新内容时推送到服务器
 */
function pollClipboard() {
  readClipboard(function (err, text) {
    if (err) {
      setTimeout(pollClipboard, CLIPBOARD_POLL_MS);
      return;
    }

    if (ignoreNextClipboardChange) {
      // 刚由服务端写入本地剪贴板，跳过本次检测
      ignoreNextClipboardChange = false;
      lastClipboardText = text;
      setTimeout(pollClipboard, CLIPBOARD_POLL_MS);
      return;
    }

    if (text !== lastClipboardText) {
      lastClipboardText = text;
      pushToServer(text);
    }

    setTimeout(pollClipboard, CLIPBOARD_POLL_MS);
  });
}

/**
 * 将本地剪贴板文本上传到服务器
 */
function pushToServer(text) {
  var pushUrl = serverUrl + '/api/sync';
  httpRequest('POST', pushUrl, { text: text, deviceId: deviceId }, function (err, data) {
    if (err) {
      log('推送失败: ' + err.message);
      return;
    }
    if (data && typeof data.version === 'number') {
      knownVersion = data.version;
    }
    log('已推送 (' + text.length + ' 字符)');
  });
}

/**
 * 轮询服务器，检查是否有来自其它设备的新内容
 */
function pollServer() {
  var syncUrl = serverUrl + '/api/sync?since=' + knownVersion;
  httpRequest('GET', syncUrl, null, function (err, data) {
    if (err) {
      setTimeout(pollServer, SERVER_POLL_MS);
      return;
    }

    if (!data || !data.changed) {
      setTimeout(pollServer, SERVER_POLL_MS);
      return;
    }

    knownVersion = data.version;

    // 只有当内容来自其它设备时才写入本地剪贴板
    if (data.lastUpdater === deviceId) {
      setTimeout(pollServer, SERVER_POLL_MS);
      return;
    }

    if (data.text === lastClipboardText) {
      setTimeout(pollServer, SERVER_POLL_MS);
      return;
    }

    log('收到远程内容 (' + data.text.length + ' 字符), 写入剪贴板...');
    ignoreNextClipboardChange = true;
    lastClipboardText = data.text;

    writeClipboard(data.text, function (writeErr) {
      if (writeErr) {
        log('写入剪贴板失败: ' + writeErr.message);
        ignoreNextClipboardChange = false;
      } else {
        log('已写入本地剪贴板');
      }
      setTimeout(pollServer, SERVER_POLL_MS);
    });
  });
}

// ─── 日志 ──────────────────────────────────────────────────

function log(msg) {
  var now = new Date();
  var hh = padZero(now.getHours());
  var mm = padZero(now.getMinutes());
  var ss = padZero(now.getSeconds());
  console.log('[' + hh + ':' + mm + ':' + ss + '] ' + msg);
}

function padZero(n) {
  return n < 10 ? '0' + n : '' + n;
}

// ─── 启动 ──────────────────────────────────────────────────

log('剪贴板同步 Agent 已启动');
log('设备 ID: ' + deviceId);
log('服务器:  ' + serverUrl);
log('平台:    ' + platform);
log('---------------------------------------');

// 初始化：读取当前剪贴板作为基准，避免启动时立即推送已有内容
readClipboard(function (err, text) {
  if (!err) {
    lastClipboardText = text;
  }

  // 初始化：获取服务器当前版本号
  httpRequest('GET', serverUrl + '/api/sync', null, function (syncErr, data) {
    if (!syncErr && data && typeof data.version === 'number') {
      knownVersion = data.version;
      log('服务器当前版本: ' + knownVersion);
    }

    pollClipboard();
    pollServer();
    log('同步已开始，Ctrl+C 退出');
  });
});
