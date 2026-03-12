# workspace-document-manager

This repository ships an OpenClaw workspace called `workspace-document-manager`.

It is a document-management workspace, not a standalone application. The workspace identity is defined by:

- `workspace-document-manager/AGENTS.md`
- `workspace-document-manager/BOOTSTRAP.md`
- `workspace-document-manager/HEARTBEAT.md`
- `workspace-document-manager/IDENTITY.md`
- `workspace-document-manager/SOUL.md`
- `workspace-document-manager/TOOLS.md`
- `workspace-document-manager/USER.md`

The workspace contains exactly 2 skills:

- `gmail`
- `google-drive`

## Install into an existing OpenClaw workspace

Linux:

```bash
./install-openclaw-agent.sh ~/.openclaw/workspace
```

PowerShell:

```powershell
.\install-openclaw-agent.ps1 -WorkspacePath "$HOME/.openclaw/workspace"
```

## Required environment

- `MATON_API_KEY`
- `MATON_GMAIL_CONNECTION_ID`
- `MATON_GOOGLE_DRIVE_CONNECTION_ID`

## Resulting layout

```text
~/.openclaw/workspace/
  AGENTS.md
  BOOTSTRAP.md
  HEARTBEAT.md
  IDENTITY.md
  SOUL.md
  TOOLS.md
  USER.md
  skills/
    gmail/
    google-drive/
```
