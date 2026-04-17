#!/bin/bash
#
# 一键发版脚本
# 用法:
#   ./scripts/release.sh          # 使用 package.json 中的版本号
#   ./scripts/release.sh 1.2.0    # 指定版本号（会同步更新 package.json）
#
# 前置条件:
#   - 安装 gh CLI: brew install gh
#   - 登录 GitHub: gh auth login
#   - 安装项目依赖: npm install

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# ── 颜色 ──────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()   { echo -e "${CYAN}[发版]${NC} $1"; }
ok()    { echo -e "${GREEN}  ✓${NC} $1"; }
warn()  { echo -e "${YELLOW}  ⚠${NC} $1"; }
fail()  { echo -e "${RED}  ✗${NC} $1"; exit 1; }

# ── 检查前置工具 ──────────────────────────────────────────
command -v gh >/dev/null 2>&1 || fail "未安装 gh CLI，请执行: brew install gh"
command -v node >/dev/null 2>&1 || fail "未安装 Node.js"
command -v npm >/dev/null 2>&1 || fail "未安装 npm"

gh auth status >/dev/null 2>&1 || fail "gh 未登录，请执行: gh auth login"

# ── 版本号处理 ─────────────────────────────────────────────
CURRENT_VERSION=$(node -e "console.log(require('./package.json').version)")

if [ -n "$1" ]; then
  VERSION="$1"
  if [ "$VERSION" != "$CURRENT_VERSION" ]; then
    log "更新 package.json 版本号: $CURRENT_VERSION → $VERSION"
    npm version "$VERSION" --no-git-tag-version --allow-same-version
    ok "版本号已更新"
  fi
else
  VERSION="$CURRENT_VERSION"
fi

TAG="v$VERSION"
log "准备发布 $TAG"

# ── 检查 tag 是否已存在 ─────────────────────────────────────
if gh release view "$TAG" >/dev/null 2>&1; then
  warn "Release $TAG 已存在"
  read -p "  是否删除并重新创建？(y/N) " confirm
  if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
    gh release delete "$TAG" --yes --cleanup-tag 2>/dev/null || true
    git tag -d "$TAG" 2>/dev/null || true
    ok "旧 Release 已删除"
  else
    fail "操作取消"
  fi
fi

# ── 清理旧产物 ─────────────────────────────────────────────
log "清理 dist/ 目录..."
rm -rf dist/
ok "已清理"

# ── 打包 Mac ──────────────────────────────────────────────
log "打包 Mac 版..."
npm run build:mac 2>&1 | tail -5
MAC_DMG=$(ls dist/*.dmg 2>/dev/null | head -1)
if [ -z "$MAC_DMG" ]; then
  warn "Mac .dmg 未生成，跳过"
else
  ok "Mac: $MAC_DMG ($(du -h "$MAC_DMG" | cut -f1))"
fi

# ── 打包 Windows ──────────────────────────────────────────
log "打包 Windows 版..."
npm run build:win 2>&1 | tail -5
WIN_EXE=$(find dist -maxdepth 1 -name "*.exe" ! -name "*uninstall*" 2>/dev/null | head -1)
if [ -z "$WIN_EXE" ]; then
  warn "Windows .exe 未生成，跳过"
else
  ok "Windows: $WIN_EXE ($(du -h "$WIN_EXE" | cut -f1))"
fi

# ── 至少需要一个安装包 ────────────────────────────────────
if [ -z "$MAC_DMG" ] && [ -z "$WIN_EXE" ]; then
  fail "没有生成任何安装包，无法发版"
fi

# ── Git 提交 & Tag ─────────────────────────────────────────
log "提交版本变更..."
git add -A
if git diff --cached --quiet 2>/dev/null; then
  ok "无需提交（工作区干净）"
else
  git commit -m "release: $TAG"
  ok "已提交"
fi

git push origin HEAD 2>/dev/null || warn "push 失败，请手动 push"

# ── 创建 GitHub Release ───────────────────────────────────
log "创建 GitHub Release: $TAG"

RELEASE_NOTES="## ClipboardShare $TAG

### 安装方式
- **Mac**: 下载 .dmg 文件，拖入应用程序
- **Windows**: 下载 .exe 文件，双击安装

### 功能
- 跨设备（Mac ↔ Windows）剪贴板自动同步
- 支持本机服务器 / 远程服务器模式
- 系统托盘常驻，开机自启
- 应用内检查更新"

GH_ARGS="--title \"ClipboardShare $TAG\" --notes \"$RELEASE_NOTES\""

gh release create "$TAG" \
  --title "ClipboardShare $TAG" \
  --notes "$RELEASE_NOTES"
ok "Release 已创建"

if [ -n "$MAC_DMG" ]; then
  log "上传 Mac 安装包: $(basename "$MAC_DMG") ($(du -h "$MAC_DMG" | cut -f1))..."
  gh release upload "$TAG" "$MAC_DMG" --clobber 2>&1 &
  MAC_PID=$!
fi

if [ -n "$WIN_EXE" ]; then
  log "上传 Windows 安装包: $(basename "$WIN_EXE") ($(du -h "$WIN_EXE" | cut -f1))..."
  gh release upload "$TAG" "$WIN_EXE" --clobber 2>&1 &
  WIN_PID=$!
fi

UPLOAD_FAIL=0
if [ -n "$MAC_PID" ]; then
  if wait $MAC_PID; then
    ok "Mac 安装包上传完成"
  else
    warn "Mac 安装包上传失败"
    UPLOAD_FAIL=1
  fi
fi
if [ -n "$WIN_PID" ]; then
  if wait $WIN_PID; then
    ok "Windows 安装包上传完成"
  else
    warn "Windows 安装包上传失败"
    UPLOAD_FAIL=1
  fi
fi

if [ "$UPLOAD_FAIL" = "1" ]; then
  warn "部分文件上传失败，可以稍后手动重试: gh release upload $TAG <文件路径> --clobber"
fi

ok "Release 创建成功！"

RELEASE_URL=$(gh release view "$TAG" --json url --jq .url 2>/dev/null)
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  发版完成!${NC}"
echo -e "  版本: ${CYAN}$TAG${NC}"
[ -n "$MAC_DMG" ] && echo -e "  Mac:  ${CYAN}$(basename "$MAC_DMG")${NC}"
[ -n "$WIN_EXE" ] && echo -e "  Win:  ${CYAN}$(basename "$WIN_EXE")${NC}"
[ -n "$RELEASE_URL" ] && echo -e "  链接: ${CYAN}$RELEASE_URL${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
