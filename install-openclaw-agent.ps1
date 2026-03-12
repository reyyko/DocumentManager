param(
  [string]$WorkspacePath = "$HOME/.openclaw/workspace"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

New-Item -ItemType Directory -Force -Path (Join-Path $WorkspacePath "skills") | Out-Null

foreach ($file in @("AGENTS.md", "IDENTITY.md", "SOUL.md", "USER.md", "TOOLS.md", "HEARTBEAT.md")) {
  Copy-Item -Force (Join-Path $root $file) (Join-Path $WorkspacePath $file)
}

foreach ($skill in @("gmail", "google-drive", "document-management-agent")) {
  $target = Join-Path $WorkspacePath "skills\\$skill"
  if (Test-Path $target) {
    Remove-Item -Recurse -Force $target
  }
  Copy-Item -Recurse -Force (Join-Path $root "skills\\$skill") $target
}

Write-Host "OpenClaw document agent installed in $WorkspacePath"
