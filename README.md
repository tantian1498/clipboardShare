# clipboard-share

跨电脑剪贴板共享工具，支持两种使用方式：

1. **网页模式** — 打开浏览器手动复制粘贴（支持文本 / 图片 / 文件）
2. **Agent 模式** — 后台自动同步，一端复制另一端直接粘贴（文本）

## 快速开始

```bash
npm install
```

### 启动服务端

在任意一台电脑上运行：

```bash
node server.js
```

服务默认监听 `0.0.0.0:3846`，启动后会显示局域网访问地址。

### 网页模式

在浏览器打开 `http://<服务器IP>:3846`，支持文本输入、图片粘贴、文件上传。

### Agent 模式（自动同步剪贴板）

**最简方式** — 其中一台电脑当服务器（`--host`），另一台连接它：

```bash
# Mac 端（同时启动服务端 + Agent）
node agent.js --host

# Windows 端（连接 Mac）
node agent.js --server http://<Mac的IP>:3846
```

如果有独立服务器（VPS / 云主机），两端都用 `--server` 即可：

```bash
node agent.js --server http://你的云服务器:3846
```

启动后，任意一端 `Ctrl+C` / `Cmd+C` 复制的文本会在 1-2 秒内同步到另一端的系统剪贴板，直接 `Ctrl+V` / `Cmd+V` 即可粘贴。

#### 开机自启（推荐）

只需执行一次，之后每次开机自动后台运行，完全无感：

```bash
# 安装（服务端 + Agent 一体）
node agent.js --host --install

# 安装（仅 Agent，连接远程服务器）
node agent.js --server http://192.168.1.100:3846 --install

# 卸载
node agent.js --uninstall
```

- **macOS** — 注册为 LaunchAgent，立即生效，日志输出到 `/tmp/clipboard-share-agent.log`
- **Windows** — 在启动文件夹创建 VBS 脚本，下次登录时生效

#### Agent 工作原理

- 每 500ms 检测本地剪贴板是否有新内容，有则上传到服务器
- 每 1s 轮询服务器，发现另一端推送了新内容则写入本地剪贴板
- 通过设备 ID + 版本号机制防止循环同步

#### 平台支持

| 平台    | 读取剪贴板      | 写入剪贴板      |
| ------- | --------------- | --------------- |
| macOS   | `pbpaste`       | `pbcopy`        |
| Windows | `Get-Clipboard` | `Set-Clipboard` |
| Linux   | `xclip -o`      | `xclip`         |

> Linux 需要先安装 xclip：`sudo apt install xclip`

## 注意事项

- 服务器可以部署到云服务器（VPS），不限局域网
- Agent 模式仅同步纯文本；图片和文件请使用网页模式
- 同步延迟约 1-2 秒
