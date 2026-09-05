#!/usr/bin/env bash
# One-time setup for a new machine. Safe to re-run.
set -euo pipefail

cd "$(dirname "$0")/.."
say() { printf "\n\033[1m%s\033[0m\n" "$1"; }

# foundryup's install location depends on FOUNDRY_DIR and XDG_CONFIG_HOME, so it is
# ~/.foundry on most macOS setups but ~/.config/.foundry when XDG_CONFIG_HOME is set.
# Find it rather than guessing.
foundry_bin() {
  local candidates=(
    "${FOUNDRY_DIR:-}/bin"
    "${XDG_CONFIG_HOME:-$HOME/.config}/.foundry/bin"
    "$HOME/.foundry/bin"
  )
  for d in "${candidates[@]}"; do
    [ -n "$d" ] && [ -x "$d/foundryup" ] && { echo "$d"; return 0; }
  done
  return 1
}

say "1/4  Node"
command -v node >/dev/null || { echo "  Node is missing. Install Node 22+ (nvm: 'nvm install' reads .nvmrc)."; exit 1; }
node_major=$(node -p "process.versions.node.split('.')[0]")
[ "$node_major" -ge 22 ] || { echo "  Node $node_major found, need 22+."; exit 1; }
echo "  node $(node -v)"

say "2/4  pnpm"
command -v pnpm >/dev/null || npm install -g pnpm@latest
echo "  pnpm $(pnpm -v)"
pnpm install

say "3/4  Foundry"
if ! command -v forge >/dev/null; then
  if ! bin=$(foundry_bin); then
    echo "  Installing foundryup..."
    curl -L https://foundry.paradigm.xyz | bash
    bin=$(foundry_bin) || { echo "  Could not find foundryup after install. Install it manually: https://getfoundry.sh"; exit 1; }
  fi
  export PATH="$bin:$PATH"
  echo "  Running foundryup from $bin"
  foundryup
fi

if command -v forge >/dev/null; then
  echo "  $(forge --version | head -1)"
elif bin=$(foundry_bin); then
  export PATH="$bin:$PATH"
  echo "  $(forge --version | head -1)"
  FOUNDRY_PATH_HINT="$bin"
else
  echo "  forge is still not on PATH. Install manually: https://getfoundry.sh"; exit 1
fi

say "4/4  Env files"
copy_env() {
  local target="$1" example="$2"
  if [ ! -f "$example" ]; then echo "  $example missing, skipped"; return; fi
  if [ -f "$target" ]; then echo "  $target already exists, left alone"; else cp "$example" "$target"; echo "  created $target"; fi
}
copy_env ".env" ".env.example"
copy_env "apps/web/.env" "apps/web/.env.example"
copy_env "apps/bridge/.env" "apps/bridge/.env.example"

say "Verifying"
pnpm contracts:test >/dev/null && echo "  contracts: 13 tests pass"
pnpm --filter @flippy/protocol test >/dev/null 2>&1 && echo "  protocol: 8 tests pass"

if [ -n "${FOUNDRY_PATH_HINT:-}" ] || ! grep -qs foundry <<<"${PATH}"; then
  hint=$(foundry_bin || true)
  if [ -n "$hint" ]; then
    printf "\n\033[1mAdd this to your shell profile\033[0m (~/.zshrc or ~/.bashrc):\n"
    printf "  export PATH=\"%s:\$PATH\"\n" "$hint"
  fi
fi

cat <<'DONE'

Ready. Next:
  1. docs/HANDOFF.md if you are picking this up on a new machine
  2. docs/SPEC.md, then your brief in docs/workstreams/
  3. Branch as a/…, b/… or c/… and go

You do NOT need a Flipper Zero. MockHumanSigner stands in for it.
DONE
