/**
 * 应用更新检查模块
 *
 * 通过 GitHub Releases API 检查是否有新版本，
 * 比较语义化版本号，返回更新信息。
 */
var https = require('https');
var os = require('os');

var REPO_OWNER = 'tantian1498';
var REPO_NAME = 'clipboardShare';

/**
 * 比较两个语义化版本号
 * @returns {number} 正数=a更新, 负数=b更新, 0=相同
 */
function compareVersions(a, b) {
  var pa = a.replace(/^v/, '').split('.').map(Number);
  var pb = b.replace(/^v/, '').split('.').map(Number);
  var len = Math.max(pa.length, pb.length);
  for (var i = 0; i < len; i++) {
    var va = pa[i] || 0;
    var vb = pb[i] || 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

/**
 * 根据当前平台选择合适的下载资源
 */
function pickAsset(assets) {
  var platform = os.platform();
  var keyword = platform === 'darwin' ? '.dmg' : '.exe';
  for (var i = 0; i < assets.length; i++) {
    if (assets[i].name.indexOf(keyword) !== -1) {
      return {
        name: assets[i].name,
        url: assets[i].browser_download_url,
        size: assets[i].size
      };
    }
  }
  return null;
}

/**
 * 检查更新
 * @param {string} currentVersion - 当前版本号 (e.g. "1.0.0")
 * @param {function} callback - function(err, result)
 *   result: null=已是最新, { version, notes, asset, releaseUrl }=有更新
 */
function checkForUpdate(currentVersion, callback) {
  var opts = {
    hostname: 'api.github.com',
    path: '/repos/' + REPO_OWNER + '/' + REPO_NAME + '/releases/latest',
    method: 'GET',
    headers: {
      'User-Agent': 'ClipboardShare/' + currentVersion,
      'Accept': 'application/vnd.github.v3+json'
    }
  };

  var req = https.request(opts, function (res) {
    var chunks = [];
    res.setEncoding('utf8');
    res.on('data', function (chunk) { chunks.push(chunk); });
    res.on('end', function () {
      var raw = chunks.join('');
      if (res.statusCode === 404) {
        callback(null, null);
        return;
      }
      if (res.statusCode !== 200) {
        callback(new Error('GitHub API 返回 ' + res.statusCode), null);
        return;
      }
      try {
        var data = JSON.parse(raw);
        var latestVersion = (data.tag_name || '').replace(/^v/, '');
        if (!latestVersion) {
          callback(null, null);
          return;
        }
        if (compareVersions(latestVersion, currentVersion) <= 0) {
          callback(null, null);
          return;
        }
        var asset = pickAsset(data.assets || []);
        callback(null, {
          version: latestVersion,
          notes: data.body || '',
          asset: asset,
          releaseUrl: data.html_url || ''
        });
      } catch (e) {
        callback(new Error('解析更新信息失败'), null);
      }
    });
  });

  req.on('error', function (err) { callback(err, null); });
  req.setTimeout(10000, function () { req.destroy(new Error('检查更新超时')); });
  req.end();
}

module.exports = {
  checkForUpdate: checkForUpdate,
  compareVersions: compareVersions
};
