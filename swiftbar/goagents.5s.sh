#!/bin/bash
# Go to Agents — SwiftBar/xbar plugin.
# Install: brew install --cask swiftbar, set a plugin folder, then copy or
# symlink this file into it. The "5s" in the filename = refresh every 5 seconds.
#
#   ln -s ~/Desktop/Go-to-Agents/swiftbar/goagents.5s.sh "<your SwiftBar plugin folder>/"
#
# Make sure bun is on PATH so the go2agents symlink's shebang resolves.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.bun/bin:$PATH"
exec "$HOME/.bun/bin/go2agents" menubar
