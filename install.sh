#!/bin/sh
set -eu
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  echo '请先安装 Node.js 22 或更新版本：https://nodejs.org/' >&2
  exit 1
fi
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
curl --fail --silent --show-error --location --connect-timeout 15 --max-time 60 \
  https://raw.githubusercontent.com/Lincb522/figma-agent-cli/main/skills/figma-agent/scripts/setup.mjs \
  --output "$temporary/setup.mjs"
node "$temporary/setup.mjs" --install-skill "$@"
