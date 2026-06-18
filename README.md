# Go to Agents

**One dashboard for every Claude Code / Codex agent on your machine — no matter how it was
started — with a one-key way to get back into each one.**

You open a lot of coding agents in a lot of terminals and forget where they are. Go to
Agents finds all of them, tells you which one is waiting on you, and takes you straight
there. Sessions you've already closed show up too, ready to resume.

```
 𝕲𝖔 𝖙𝖔 𝕬𝖌𝖊𝖓𝖙𝖘
 3 live · 7 resumable · refresh 2s · / search

      VIA   AGENT   TASK                             PROJECT                 IDLE
 ▶ ● tmux  claude   Rewrite codebase Go→TS           ~/Desktop/figma-mcp-go  3s
   ▲ tmux  claude   Resume from summary?             ~/Desktop/odw           1m
   ○ term  claude   检查下项目                         ~/Desktop/json-render   2h
   ○ zzz   codex    Review for sensitive info        ~/Desktop/Figma-to-HTML 2d

 ● working  ▲ needs you  ○ idle
 ↑/↓ · ⏎ open in a new window · / search · x kill · r refresh · q quit
```

It's pure observation — nothing is injected into your running agents. Keep typing `claude`
or `codex` in any terminal exactly like you do now; the dashboard just sees them.

---

## What ⏎ does — three kinds of agent

Every row is one of three origins, and Enter does the right thing for each:

| VIA | What it is | ⏎ does |
|---|---|---|
| `tmux` | Running, managed by Go to Agents | **Open it in a new terminal window** (`tmux attach`). Detach with `Ctrl-b d`; the agent keeps running. |
| `term` | Running, started by you in some terminal | **Focus that terminal** — the exact tab in iTerm2 / Terminal.app, or the app to the front in Ghostty / Warp. |
| `zzz` | Not running — a recent session on disk | **Resume it** (`claude --resume` / `codex resume`) inside a managed tmux session. From then on it's a `tmux` row, reachable from any terminal. |

Agents open in a **new window** so the dashboard stays put as a control hub. The new
window follows the terminal you ran the dashboard in; override with `GTA_TERMINAL`
(`iterm`, `ghostty`, `apple_terminal`).

## Knowing which agent needs you

Status comes from the agent's **actual screen** (`tmux capture-pane`), not a guess based on
how long it's been quiet:

- `●` **working** — actively running (`esc to interrupt` on screen)
- `▲` **needs you** — blocked on a prompt: a permission request or a choice
- `○` **idle** — waiting at an empty input box

`go2agents watch` turns those moments into desktop notifications — with sound when an agent
needs you — so you can close the dashboard and still get pinged the instant an agent is
blocked or finishes a long task. Notifications also fire while the dashboard is open.

## Search every session

Press `/` in the dashboard (or run `go2agents search <query>`) to full-text search across
**every** Claude and Codex session on disk via ripgrep — live and closed alike. Find the
conversation where you solved something and resume it on the spot.

## Menu bar (macOS)

A live menu-bar icon that turns 🟡 the moment any agent needs you, with a dropdown of every
agent — click one to jump straight in.

```bash
brew install --cask swiftbar          # a small open-source menu-bar runner
mkdir -p ~/.swiftbar
ln -s "$PWD/swiftbar/goagents.5s.sh" ~/.swiftbar/
open -a SwiftBar                       # then pick ~/.swiftbar as the plugin folder
```

---

## Install

### Homebrew (recommended)

Pulls in `tmux` and `ripgrep` for you:

```bash
brew install fihaaade/tap/go2agents
# or, before a tagged release exists:
brew install --HEAD fihaaade/tap/go2agents
```

### From source

```bash
git clone https://github.com/fihaaade/Go-to-Agents
cd Go-to-Agents
bun install && bun link     # installs the `go2agents` command (short alias: `gta`)
brew install tmux ripgrep   # runtime dependencies
```

> If a new shell can't find `go2agents`, add Bun's bin dir to your PATH:
> `export PATH="$HOME/.bun/bin:$PATH"`. The `gta` alias is also installed, but a shell
> alias (e.g. `alias gta='git tag …'`) can shadow it — prefer `go2agents`.

## Commands

```bash
go2agents                      # the dashboard
go2agents new [path] [--codex] # start a managed agent in <path> and jump in
go2agents search <query>       # full-text search across all Claude + Codex sessions
go2agents watch [seconds]      # headless monitor; desktop-notify when an agent needs you
go2agents menubar              # SwiftBar/xbar plugin output
go2agents go <key>             # run the action for a catalog entry (used by the menu bar)
go2agents --json               # machine-readable catalog
```

Dashboard keys: `↑/↓` (or `j/k`) move · `⏎` open · `/` search · `x` kill a managed session
· `r` refresh · `q` quit.

## How it works

All observation, no injection:

- **Managed** — sessions Go to Agents created, run as the pane process of a detached tmux
  session named `gta-<kind>-<slug>` (`tmux list-panes` for pid / cwd / activity; status
  from `tmux capture-pane`).
- **External** — `ps` finds interactive `claude` / `codex` on a tty (tmux panes excluded so
  they're not double-counted); `lsof` resolves the cwd; the PPID chain names the owning
  terminal app.
- **Dormant** — recent JSONL transcripts under `~/.claude/projects/**` and
  `~/.codex/sessions/**`; the cwd and task label are read from the log content. Sessions
  already represented by a live agent are deduped by session id.
- **Resume** — a dormant session is revived *into* a managed tmux session, so afterwards
  it's permanently reachable from any terminal.

## Requirements

- macOS
- [Bun](https://bun.sh)
- tmux — `brew install tmux`
- ripgrep — `brew install ripgrep` (for search)
- SwiftBar — `brew install --cask swiftbar` (optional, for the menu bar)

## Honest limitations

- A **live external** agent can't be attached — its pty belongs to its terminal window (an
  OS-level constraint). ⏎ jumps you to that window instead. Start agents with
  `go2agents new`, or resume them from a `zzz` row, to make them fully attachable anywhere.
- Resuming a session that is *also* still open live elsewhere would fork the conversation;
  the dashboard avoids this by deduping live session ids.
- Ghostty / Warp focus is app-level, not tab-level (they expose no per-tab scripting API).
- Screen-accurate status and notifications cover **managed** agents; external agents fall
  back to an activity-time heuristic.
- macOS only for now. The platform-specific parts (opening / focusing windows, desktop
  notifications) are isolated behind small adapters, with Linux/Windows stubs in place.

## Roadmap

- Linux / Windows window + notification adapters
- Create and configure agents from inside the dashboard
- Richer session preview and search result context
- Remote / mobile view
