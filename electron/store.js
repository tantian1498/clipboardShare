/**
 * 持久化配置管理 — JSON 文件读写
 *
 * 配置存储在 Electron userData 目录或 ~/.clipboard-share/config.json
 */
var fs = require('fs');
var path = require('path');
var os = require('os');

var DEFAULTS = {
  mode: 'host',
  serverUrl: '',
  port: 3846,
  autoLaunch: false
};

function Store(configDir) {
  this._dir = configDir || path.join(os.homedir(), '.clipboard-share');
  this._file = path.join(this._dir, 'config.json');
  this._data = null;
}

Store.prototype._ensureDir = function () {
  if (!fs.existsSync(this._dir)) {
    fs.mkdirSync(this._dir, { recursive: true });
  }
};

Store.prototype.load = function () {
  this._ensureDir();
  if (fs.existsSync(this._file)) {
    try {
      var raw = fs.readFileSync(this._file, 'utf8');
      var parsed = JSON.parse(raw);
      this._data = {};
      var key;
      for (key in DEFAULTS) {
        if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
          this._data[key] = Object.prototype.hasOwnProperty.call(parsed, key) ? parsed[key] : DEFAULTS[key];
        }
      }
    } catch (e) {
      this._data = JSON.parse(JSON.stringify(DEFAULTS));
    }
  } else {
    this._data = JSON.parse(JSON.stringify(DEFAULTS));
  }
  return this._data;
};

Store.prototype.save = function (data) {
  this._ensureDir();
  if (data) {
    var key;
    for (key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key) && Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
        this._data[key] = data[key];
      }
    }
  }
  fs.writeFileSync(this._file, JSON.stringify(this._data, null, 2), 'utf8');
  return this._data;
};

Store.prototype.get = function (key) {
  if (!this._data) this.load();
  return this._data[key];
};

Store.prototype.set = function (key, value) {
  if (!this._data) this.load();
  this._data[key] = value;
  this.save();
};

Store.prototype.getAll = function () {
  if (!this._data) this.load();
  return JSON.parse(JSON.stringify(this._data));
};

module.exports = Store;
