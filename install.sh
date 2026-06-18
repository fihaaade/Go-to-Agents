#!/usr/bin/env bash
# Go to Agents installer.
#   curl -fsSL https://raw.githubusercontent.com/fihaaade/Go-to-Agents/main/install.sh | bash
# Re-run anytime to update. Uninstall: rm -rf ~/.go2agents ~/.local/bin/go2agents ~/.local/bin/gta
set -euo pipefail

REPO="https://github.com/fihaaade/Go-to-Agents.git"
DEST="${GO2AGENTS_DIR:-$HOME/.go2agents}"
BIN_DIR="${GO2AGENTS_BIN:-$HOME/.local/bin}"

say() { printf '\033[36m›\033[0m %s\n' "$1"; }
warn() { printf '\033[33m⚠\033[0m %s\n' "$1"; }

# 1. bun (runtime) — bootstrap if missing
if ! command -v bun >/dev/null 2>&1; then
  say "Installing bun…"
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi
BUN_BIN="$(command -v bun)"

# 2. system dependencies — try to install via Homebrew, else warn
for pair in "tmux:tmux" "rg:ripgrep"; do
  cmd="${pair%%:*}"; pkg="${pair##*:}"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
      say "Installing $pkg…"; brew install "$pkg"
    else
      warn "$pkg not found — please install it ($cmd is required)."
    fi
  fi
done

# 3. fetch / update source
if [ -d "$DEST/.git" ]; then
  say "Updating $DEST…"; git -C "$DEST" pull --ff-only
else
  say "Cloning into $DEST…"; git clone --depth 1 "$REPO" "$DEST"
fi

# 4. install JS dependencies
say "Installing dependencies…"
( cd "$DEST" && "$BUN_BIN" install --production )

# 5. launchers on PATH (go2agents + short alias gta)
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/go2agents" <<EOF
#!/usr/bin/env bash
exec "$BUN_BIN" run "$DEST/src/cli.tsx" "\$@"
EOF
chmod +x "$BIN_DIR/go2agents"
ln -sf "$BIN_DIR/go2agents" "$BIN_DIR/gta"

# 6. PATH hint
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) warn "Add this to your shell profile:  export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac

printf '\033[32m✓\033[0m Installed. Run \033[1mgo2agents\033[0m\n'
