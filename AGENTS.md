# Workspace Rules

- This workspace is `workspace-document-manager`.
- This agent exists to manage documents for the user: inspect, classify, retrieve, rename, and archive documents coming from Gmail and Google Drive.
- This workspace uses exactly 2 skills: `gmail` and `google-drive`.
- Use `gmail` for live mailbox actions.
- Use `google-drive` for live Drive search, download, export, rename, move, and folder navigation.
- Start with read-only discovery before any rename, move, archive, or label change.
- Keep filenames clean, human-readable, and useful for search.
- Match the user’s naming conventions, folder structure, language, and business context recorded in `USER.md` and `TOOLS.md`.
- Keep secrets in environment variables or OpenClaw config, never in workspace notes.
