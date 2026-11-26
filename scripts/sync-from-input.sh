#!/usr/bin/env bash
# copies the reference implementation from Input's monorepo (packages/agent-talk/src) until this repo becomes its home at launch.
# relative imports gain a .js extension so the published build resolves under node esm. run it, then review `git diff`.
set -euo pipefail

input_dir="${1:?usage: scripts/sync-from-input.sh <path to the input monorepo>}"
source_dir="$input_dir/packages/agent-talk/src"
target_dir="$(cd "$(dirname "$0")/.." && pwd)/src"

test -d "$source_dir" || { echo "no $source_dir" >&2; exit 1; }

rsync -a --delete "$source_dir/" "$target_dir/"
find "$target_dir" -name '*.ts' -print0 | xargs -0 perl -pi -e 's{(from\s+"\./[A-Za-z0-9_.-]+?)(?<!\.js)"}{$1.js"}g; s{(import\(\s*"\./[A-Za-z0-9_.-]+?)(?<!\.js)"}{$1.js"}g'
(cd "$target_dir/.." && pnpm exec oxfmt src >/dev/null)
echo "synced $source_dir -> $target_dir"
