#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ID="win11-fullscreen-stacking"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${HOME}/.local/share/kwin/scripts/${SCRIPT_ID}"

mkdir -p "${TARGET_DIR}/contents/code"
cp "${SCRIPT_DIR}/metadata.json" "${TARGET_DIR}/metadata.json"
cp "${SCRIPT_DIR}/contents/code/main.js" "${TARGET_DIR}/contents/code/main.js"

kwriteconfig6 --file kwinrc --group Plugins --key "${SCRIPT_ID}Enabled" true

if command -v qdbus6 >/dev/null 2>&1; then
    qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript "${SCRIPT_ID}" >/dev/null 2>&1 || true
    qdbus6 org.kde.KWin /KWin reconfigure
    qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.start
elif command -v qdbus >/dev/null 2>&1; then
    qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript "${SCRIPT_ID}" >/dev/null 2>&1 || true
    qdbus org.kde.KWin /KWin reconfigure
    qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.start
fi

echo "Installed and enabled '${SCRIPT_ID}' in ${TARGET_DIR}"
