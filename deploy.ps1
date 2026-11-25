#Requires -Version 5.1
<#
  键区拔河 · 公网部署脚本（Render 免费实例）
  用法：
    powershell -ExecutionPolicy Bypass -File deploy.ps1
    powershell -ExecutionPolicy Bypass -File deploy.ps1 -RepoName my-tug -SkipTests
#>
[CmdletBinding()]
param(
  [string]$RepoName = 'keyboard-tug',
  [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "  ok  $text" -ForegroundColor Green }
function Warn($text) { Write-Host "  !   $text" -ForegroundColor Yellow }
function Fail($text) { Write-Host "`n[x] $text" -ForegroundColor Red; exit 1 }

Step '检查环境'
foreach ($cmd in @('node', 'npm', 'git')) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Fail "找不到 $cmd，请先安装后再运行本脚本。"
  }
}
Ok ("node " + (& node --version))
Ok ((& git --version))

Step '安装依赖'
if (Test-Path 'package-lock.json') {
  & npm ci
} else {
  & npm install
}
if ($LASTEXITCODE -ne 0) { Fail '依赖安装失败。' }

if (-not $SkipTests) {
  Step '运行本地测试'
  & npm test
  if ($LASTEXITCODE -ne 0) { Fail '测试未通过，已停止部署。修好后再运行。' }
  Ok '25 项测试全部通过'
}

Step '准备 Git 仓库'
if (-not (Test-Path '.git')) {
  & git init | Out-Null
  & git branch -M main
  Ok '已初始化本地仓库'
}
$pending = & git status --porcelain
if ($pending) {
  & git add -A
  & git commit -m 'chore: 部署公网双人对战' | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail '提交失败，请检查 Git 用户配置。' }
  Ok '已提交本地改动'
} else {
  Ok '没有待提交的改动'
}

$remote = ''
try { $remote = (& git remote get-url origin) } catch { $remote = '' }

$ghReady = $false
if (Get-Command gh -ErrorAction SilentlyContinue) {
  & gh auth status 2>&1 | Out-Null
  $ghReady = ($LASTEXITCODE -eq 0)
}

if (-not $remote) {
  if ($ghReady) {
    Step "创建 GitHub 仓库 $RepoName 并推送"
    & gh repo create $RepoName --public --source=. --remote=origin --push
    if ($LASTEXITCODE -ne 0) { Fail 'gh 建仓失败，请手动创建仓库后重跑。' }
    Ok '代码已推送到 GitHub'
  } else {
    Warn '没有可用的 GitHub 远程仓库，也没有登录 gh CLI。'
    Warn '请手动执行：gh auth login，或新建仓库后运行 git remote add origin <地址>'
  }
} else {
  Step '推送到已有远程仓库'
  & git push -u origin HEAD
  if ($LASTEXITCODE -ne 0) { Warn '推送失败，请确认远程仓库权限后手动 git push。' }
  else { Ok '已推送' }
}

Step '在 Render 创建免费实例'
Write-Host @'
  1. 打开 https://dashboard.render.com/blueprints
  2. 点 New Blueprint Instance，选择刚推送的 GitHub 仓库
  3. 仓库里的 render.yaml 会被自动识别，直接 Apply
  4. 构建完成后得到公网地址，形如 https://keyboard-tug.onrender.com

  联机入口：https://<服务名>.onrender.com/versus.html
  创建房间后把链接发给朋友，对方打开即自动加入。

  免费实例注意：
  - 15 分钟无人访问会休眠，再次打开需等 30~60 秒冷启动
  - 休眠会断开已开的对局，建议开局前先刷新唤醒
  - 默认新加坡节点，国内访问可能偏慢，必要时可换 Zeabur/Railway
'@
