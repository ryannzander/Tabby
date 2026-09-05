#!/usr/bin/env bash
# One-time setup for a new machine. Safe to re-run.
set -euo pipefail

cd "$(dirname "$0")/.."
say() { printf "\n\033[1m%s\033[0m\n" "$1"; }

say "1/4  Node"
if ! command -v node >/dev/null; then
  echo "  Node is missing. Install Node 22 (nvm: 'nvm install' picks up .nvmrc)." && exit 1
fi
node_major=$(node -p "process.versions.node.split('.')[0]")
[ "$node_major" -ge 22 ] || { echo "  Node $node_major found, need 22+."; exit 1; }
echo "  node $(node -v)"

say "2/4  pnpm"
command -v pnpm >/dev/null || npm install -g pnpm@latest
echo "  pnpm $(pnpm -v)"
pnpm install

say "3/4  Foundry"
if ! command -v forge >/dev/null; then
  echo "  Installing Foundry..."
  curl -L https://foundry.paradigm.xyz | bash
  # shellcheck disable=SC1090
  export PATH="$HOME/.foundry/bin:$PATH"
  foundryup
  echo "  Add this to your shell profile:  export PATH=\"\$HOME/.foundry/bin:\$PATH\""
fi
echo "  $(forge --version | head -1)"

say "4/4  Env files"
for f in .env apps/web/.env apps/bridge/.env; do
  ex="${f%.env}.env.example"; [ "$f" = ".env" ] && ex=".env.example"
  if [ -f "$ex" ] && [ ! -f "$f" ]; then cp "$ex" "$f"; echo "  created $f"; else echo "  $f ok"; fi
done

say "Verifying"
pnpm contracts:test >/dev/null && echo "  contracts: 13 tests pass"
pnpm --filter @flippy/protocol test >/dev/null 2>&1 && echo "  protocol: tests pass"

cat <<'DONE'

Ready. Next:
  1. Read docs/SPEC.md, then your brief in docs/workstreams/
  2. Fill in the keys you need in .env (all testnet, all disposable)
  3. Branch as a/…, b/… or c/… and go

You do NOT need a Flipper Zero. MockHumanSigner stands in for it.
DONE
