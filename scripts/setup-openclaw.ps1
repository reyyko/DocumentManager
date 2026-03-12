$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'
$stateDir = Join-Path $root '.openclaw'
$workspaceDir = Join-Path $root 'workspace'
$skillsDir = Join-Path $workspaceDir 'skills'
$configPath = Join-Path $stateDir 'openclaw.json'

function Get-EnvMap {
  param([string]$Path)

  $map = @{}
  if (-not (Test-Path $Path)) {
    return $map
  }

  foreach ($line in Get-Content $Path) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) {
      continue
    }

    $pair = $line -split '=', 2
    if ($pair.Count -eq 2) {
      $map[$pair[0]] = $pair[1]
    }
  }

  return $map
}

function Set-Or-AppendEnvValue {
  param(
    [string]$Path,
    [string]$Key,
    [string]$Value
  )

  $lines = @()
  if (Test-Path $Path) {
    $lines = [System.Collections.Generic.List[string]](Get-Content $Path)
  } else {
    New-Item -ItemType File -Path $Path | Out-Null
    $lines = [System.Collections.Generic.List[string]]::new()
  }

  $updated = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^${Key}=") {
      $lines[$i] = "${Key}=${Value}"
      $updated = $true
      break
    }
  }

  if (-not $updated) {
    $lines.Insert(0, "${Key}=${Value}")
  }

  Set-Content -Path $Path -Value $lines
}

function Ensure-Directory {
  param([string]$Path)
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Get-DiscordGuildId {
  param(
    [string]$BotToken,
    [string]$ChannelId
  )

  if ([string]::IsNullOrWhiteSpace($BotToken) -or [string]::IsNullOrWhiteSpace($ChannelId)) {
    return $null
  }

  try {
    $headers = @{ Authorization = "Bot $BotToken" }
    $channel = Invoke-RestMethod -Headers $headers -Uri "https://discord.com/api/v10/channels/$ChannelId" -Method Get
    return $channel.guild_id
  } catch {
    Write-Warning "Impossible de resoudre le guild Discord depuis le channel $ChannelId."
    return $null
  }
}

function Normalize-GoogleDriveFolderId {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $Value
  }

  if ($Value -match '/folders/([A-Za-z0-9_-]+)') {
    return $Matches[1]
  }

  return $Value
}

function Ensure-Hashtable {
  param([object]$Value)

  if ($null -eq $Value) {
    return @{}
  }

  if ($Value -is [System.Collections.IDictionary]) {
    return $Value
  }

  $hash = @{}
  foreach ($property in $Value.PSObject.Properties) {
    $hash[$property.Name] = $property.Value
  }
  return $hash
}

Ensure-Directory $stateDir
Ensure-Directory (Join-Path $stateDir 'identity')
Ensure-Directory (Join-Path $stateDir 'agents\main\agent')
Ensure-Directory (Join-Path $stateDir 'agents\main\sessions')
Ensure-Directory $workspaceDir
Ensure-Directory $skillsDir
Ensure-Directory (Join-Path $workspaceDir 'inbound')
Ensure-Directory (Join-Path $workspaceDir 'inbound\manual-depot')
Ensure-Directory (Join-Path $workspaceDir 'inbound\processed')

$envMap = Get-EnvMap -Path $envFile
if (-not $envMap.ContainsKey('OPENCLAW_GATEWAY_TOKEN') -or [string]::IsNullOrWhiteSpace($envMap['OPENCLAW_GATEWAY_TOKEN'])) {
  $token = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 64 | ForEach-Object { [char]$_ })
  Set-Or-AppendEnvValue -Path $envFile -Key 'OPENCLAW_GATEWAY_TOKEN' -Value $token
  $envMap['OPENCLAW_GATEWAY_TOKEN'] = $token
}

$defaults = @{
  OPENCLAW_IMAGE = 'ghcr.io/openclaw/openclaw:latest'
  OPENCLAW_CONFIG_DIR = './.openclaw'
  OPENCLAW_WORKSPACE_DIR = './workspace'
  OPENCLAW_GATEWAY_PORT = '18789'
  OPENCLAW_BRIDGE_PORT = '18790'
  OPENCLAW_GATEWAY_BIND = 'lan'
  GOOGLE_DRIVE_PROVISION_ON_START = 'false'
  NATIVE_GOOGLE_CONNECTORS_ENABLED = 'false'
}

foreach ($entry in $defaults.GetEnumerator()) {
  if (-not $envMap.ContainsKey($entry.Key) -or [string]::IsNullOrWhiteSpace($envMap[$entry.Key])) {
    Set-Or-AppendEnvValue -Path $envFile -Key $entry.Key -Value $entry.Value
    $envMap[$entry.Key] = $entry.Value
  }
}

$driveRoot = Normalize-GoogleDriveFolderId $envMap['GOOGLE_DRIVE_ROOT_FOLDER_ID']
if ($driveRoot -and $driveRoot -ne $envMap['GOOGLE_DRIVE_ROOT_FOLDER_ID']) {
  Set-Or-AppendEnvValue -Path $envFile -Key 'GOOGLE_DRIVE_ROOT_FOLDER_ID' -Value $driveRoot
  $envMap['GOOGLE_DRIVE_ROOT_FOLDER_ID'] = $driveRoot
}

$config = @{}
if (Test-Path $configPath) {
  $raw = Get-Content $configPath -Raw
  if (-not [string]::IsNullOrWhiteSpace($raw)) {
    $config = Ensure-Hashtable (ConvertFrom-Json $raw)
  }
}

$config['gateway'] = Ensure-Hashtable $config['gateway']
$config['gateway']['mode'] = 'local'
$config['gateway']['bind'] = $envMap['OPENCLAW_GATEWAY_BIND']
$config['channels'] = Ensure-Hashtable $config['channels']
$config['agents'] = Ensure-Hashtable $config['agents']
$config['agents']['defaults'] = Ensure-Hashtable $config['agents']['defaults']
$model = Ensure-Hashtable $config['agents']['defaults']['model']
if (-not $model.ContainsKey('primary') -or [string]::IsNullOrWhiteSpace($model['primary']) -or $model['primary'] -like 'anthropic/*' -or $model['primary'] -like 'openai/*') {
  $model['primary'] = 'openai-codex/gpt-5.4'
}
$config['agents']['defaults']['model'] = $model

$discordToken = $envMap['DISCORD_BOT_TOKEN']
if (-not [string]::IsNullOrWhiteSpace($discordToken)) {
  $discord = Ensure-Hashtable $config['channels']['discord']
  $discord['enabled'] = $true
  $discord['groupPolicy'] = 'allowlist'

  $guildId = $envMap['DISCORD_SERVER_ID']
  if ([string]::IsNullOrWhiteSpace($guildId)) {
    $guildId = Get-DiscordGuildId -BotToken $discordToken -ChannelId $envMap['DISCORD_VD_MANAGER_CHANNEL_ID']
  }

  if (-not [string]::IsNullOrWhiteSpace($guildId)) {
    $guilds = Ensure-Hashtable $discord['guilds']
    $guild = Ensure-Hashtable $guilds[$guildId]
    $guild['requireMention'] = $false

    $ownerId = $envMap['DISCORD_OWNER_USER_ID']
    if ([string]::IsNullOrWhiteSpace($ownerId)) {
      $ownerId = $envMap['DEFAULT_APPROVER_DISCORD_ID']
    }
    if (-not [string]::IsNullOrWhiteSpace($ownerId)) {
      $guild['users'] = @($ownerId)
    }

    $guilds[$guildId] = $guild
    $discord['guilds'] = $guilds
  }

  $config['channels']['discord'] = $discord
}

$json = $config | ConvertTo-Json -Depth 100
Set-Content -Path $configPath -Value $json

docker compose pull openclaw-gateway openclaw-cli
docker compose up -d --build openclaw-gateway postgres redis document-api

Write-Host "OpenClaw gateway started."
Write-Host "Dashboard: http://127.0.0.1:$($envMap['OPENCLAW_GATEWAY_PORT'])/"
Write-Host "Document API: http://127.0.0.1:3000/"
Write-Host "Skills path: $skillsDir"
Write-Host "Gateway token stored in .env"
