param(
  [string]$WorkspacePath = "$HOME/.openclaw/workspace"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$source = Join-Path $root ".openclaw\\workspace-document-manager"

New-Item -ItemType Directory -Force -Path (Join-Path $WorkspacePath "skills") | Out-Null

foreach ($file in @("AGENTS.md", "BOOTSTRAP.md", "HEARTBEAT.md", "IDENTITY.md", "SOUL.md", "TOOLS.md", "USER.md")) {
  Copy-Item -Force (Join-Path $source $file) (Join-Path $WorkspacePath $file)
}

foreach ($skill in @("gmail", "google-drive")) {
  $target = Join-Path $WorkspacePath "skills\\$skill"
  if (Test-Path $target) {
    Remove-Item -Recurse -Force $target
  }
  Copy-Item -Recurse -Force (Join-Path $source "skills\\$skill") $target
}

$legacyTarget = Join-Path $WorkspacePath "skills\\document-management-agent"
if (Test-Path $legacyTarget) {
  Remove-Item -Recurse -Force $legacyTarget
}

Write-Host "workspace-document-manager installed in $WorkspacePath"
