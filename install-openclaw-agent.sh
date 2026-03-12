#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-$HOME/.openclaw/workspace}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$TARGET/skills"

for file in AGENTS.md IDENTITY.md SOUL.md USER.md TOOLS.md HEARTBEAT.md; do
  cp "$SCRIPT_DIR/$file" "$TARGET/$file"
done

rm -rf "$TARGET/skills/gmail" "$TARGET/skills/google-drive" "$TARGET/skills/document-management-agent"
cp -R "$SCRIPT_DIR/skills/gmail" "$TARGET/skills/gmail"
cp -R "$SCRIPT_DIR/skills/google-drive" "$TARGET/skills/google-drive"
cp -R "$SCRIPT_DIR/skills/document-management-agent" "$TARGET/skills/document-management-agent"

echo "OpenClaw document agent installed in $TARGET"
