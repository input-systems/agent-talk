#!/usr/bin/env bash
# copies the reference implementation from Input's monorepo (packages/agent-talk/src at its checked-out commit, never
# uncommitted work) until this repo becomes its home at launch. relative imports gain a .js extension so the published build
# resolves under node esm. run it, then review `git diff`.
set -euo pipefail

input_dir="${1:?usage: scripts/sync-from-input.sh <path to the input monorepo>}"
target_dir="$(cd "$(dirname "$0")/.." && pwd)/src"
source_path="packages/agent-talk/src"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

git -C "$input_dir" archive HEAD "$source_path" | tar -x -C "$work_dir"
test -d "$work_dir/$source_path" || { echo "no $source_path at HEAD of $input_dir" >&2; exit 1; }

rsync -a --delete "$work_dir/$source_path/" "$target_dir/"
find "$target_dir" -name '*.ts' -print0 | xargs -0 perl -pi -e 's{(from\s+"\./[A-Za-z0-9_.-]+?)(?<!\.js)"}{$1.js"}g; s{(import\(\s*"\./[A-Za-z0-9_.-]+?)(?<!\.js)"}{$1.js"}g'
(cd "$target_dir/.." && pnpm exec oxfmt src >/dev/null)
echo "synced $input_dir ($(git -C "$input_dir" rev-parse --short HEAD)) -> $target_dir"
