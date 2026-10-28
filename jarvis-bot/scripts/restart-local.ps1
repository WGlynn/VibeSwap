# Restart the local Jarvis TG bot on Will's PC.
#
# Windows cannot send SIGTERM to another process, so a restart from outside always looks like
# a crash to the bot's heartbeat check. If the bot is running, this script leaves a
# planned-restart marker first, so the next boot does not report its own restart as an unclean
# shutdown. Previous logs are kept (renamed with a timestamp) instead of being overwritten, so
# a real crash leaves evidence the next boot can attach to its health event.
#
# Usage (PowerShell):  powershell -File scripts\restart-local.ps1

param([switch]$Force)
$ErrorActionPreference = 'Stop'
$bot = Split-Path -Parent $PSScriptRoot
# Gate (2026-10-28): every live bug that day sat on a path no test or check covered (a removed
# variable that threw on every Ollama reply, among others). Refuse to restart onto code that fails
# the suite or the undefined-variable lint; -Force overrides in an emergency.
if (-not $Force) {
  Push-Location $bot
  try {
    & npm run -s lint:undef
    if ($LASTEXITCODE -ne 0) { throw 'lint:undef failed (undefined variable in src/). Fix it, or rerun with -Force.' }
    & npm test --silent | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'npm test failed. Fix it, or rerun with -Force.' }
  } finally { Pop-Location }
}
$logs = Join-Path $HOME 'jarvis-bot-logs'
$pidFile = Join-Path $logs 'pid.txt'
New-Item -ItemType Directory -Force -Path $logs | Out-Null

$running = $null
if (Test-Path $pidFile) {
  $running = Get-Process -Id ([int](Get-Content $pidFile)) -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -eq 'node' }
}
if ($running) {
  @{ at = (Get-Date).ToUniversalTime().ToString('o'); by = $env:USERNAME } |
    ConvertTo-Json | Set-Content (Join-Path $bot 'data\planned-restart.json')
  Stop-Process -Id $running.Id -Force
  Start-Sleep -Seconds 2
}

$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$out = Join-Path $logs 'bot.log'
$err = Join-Path $logs 'bot.err.log'
$prev = @{}
foreach ($f in @($out, $err)) {
  if (Test-Path $f) {
    $dest = $f -replace '\.log$', "-$stamp.log"
    Move-Item $f $dest
    $prev[[IO.Path]::GetFileName($f)] = $dest
  }
}
$prev | ConvertTo-Json | Set-Content (Join-Path $bot 'data\last-run-logs.json')

$p = Start-Process -FilePath node -ArgumentList '--expose-gc', 'src/index.js' -WorkingDirectory $bot `
  -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden -PassThru
$p.Id | Set-Content $pidFile
Write-Output "started PID $($p.Id) (planned restart: $([bool]$running))"
