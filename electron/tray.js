/**
 * 系统托盘管理
 */
var path = require('path');
var electron = require('electron');
var Tray = electron.Tray;
var Menu = electron.Menu;
var nativeImage = electron.nativeImage;

var tray = null;

/**
 * 创建系统托盘
 * @param {object} opts
 * @param {function} opts.onShowWindow - 打开设置窗口
 * @param {function} opts.onToggleAutoLaunch - 切换开机自启
 * @param {function} opts.onQuit - 退出应用
 * @param {boolean} opts.autoLaunch - 当前自启状态
 * @param {boolean} opts.connected - 当前连接状态
 */
function createTray(opts) {
  var iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  var icon = nativeImage.createFromPath(iconPath);
  // macOS 托盘图标建议 16x16，设为 Template 适配暗色模式
  if (process.platform === 'darwin') {
    icon = icon.resize({ width: 16, height: 16 });
    icon.setTemplateImage(true);
  }

  tray = new Tray(icon);
  tray.setToolTip('ClipboardShare');

  updateMenu(opts);

  tray.on('click', function () {
    if (opts.onShowWindow) opts.onShowWindow();
  });

  return tray;
}

/**
 * 更新托盘菜单（状态变更时调用）
 */
function updateMenu(opts) {
  if (!tray) return;

  var statusLabel = opts.connected ? '状态: 已连接' : '状态: 未连接';

  var template = [
    { label: statusLabel, enabled: false },
    { type: 'separator' },
    {
      label: '打开设置',
      click: function () { if (opts.onShowWindow) opts.onShowWindow(); }
    },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: !!opts.autoLaunch,
      click: function () { if (opts.onToggleAutoLaunch) opts.onToggleAutoLaunch(); }
    },
    {
      label: '检查更新',
      click: function () { if (opts.onCheckUpdate) opts.onCheckUpdate(); }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: function () { if (opts.onQuit) opts.onQuit(); }
    }
  ];

  var menu = Menu.buildFromTemplate(template);
  tray.setContextMenu(menu);
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = {
  createTray: createTray,
  updateMenu: updateMenu,
  destroyTray: destroyTray
};
