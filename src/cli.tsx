#!/usr/bin/env bun
// The PARENT process. Deliberately Ink-free: it never touches raw mode, so the
// terminal it hands to `tmux attach` is always clean. The Ink dashboard runs in
// a child process (dashboard.tsx) that reports the chosen action via a file.
import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync, rmSync, appendFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import * as tmux from "./tmux.js";
import { focusTty } from "./terminals.js";
import { openInNewWindow } from "./launcher.js";
import { StatusTracker, notifyTransition } from "./notify.js";
import type { Action } from "./app.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

function requireTmux() {
  if (!tmux.installed()) {
    console.error("tmux is required. Install it with:  brew install tmux");
    process.exit(1);
  }
}

// Some terminals (Ghostty: TERM=xterm-ghostty) ship terminfo that the system
// curses can't resolve; the tmux client then dies instantly with "missing or
// unsuitable terminal". Fall back to a universal TERM for the client.
function tmuxEnv(): NodeJS.ProcessEnv {
  const term = process.env.TERM ?? "";
  try {
    execFileSync("infocmp", [term], { stdio: "ignore" });
    return process.env;
  } catch {
    return { ...process.env, TERM: "xterm-256color" };
  }
}

// Hand the current terminal to a session (attach), or switch if already in tmux.
function goto(session: string) {
  const r = spawnSync("tmux", tmux.gotoArgs(session), { stdio: "inherit", env: tmuxEnv() });
  if (r.status !== 0)
    console.error(`tmux exited with status ${r.status}${r.error ? `: ${r.error.message}` : ""}`);
}

// ── `gta new [path] [--codex]` — create a session and jump straight in ────────
if (argv[0] === "new") {
  requireTmux();
  const kind = argv.includes("--codex") ? "codex" : "claude";
  const pathArg = argv.slice(1).find((a) => !a.startsWith("-"));
  const cwd = resolve(pathArg ?? process.cwd());
  const name = tmux.create(cwd, kind);
  console.error(`Started ${kind} in ${cwd}  (tmux: ${name})`);
  goto(name);
  process.exit(0);
}

// Open an agent in a NEW window so the dashboard stays put as a hub.
async function openSession(name: string) {
  const r = await openInNewWindow(["tmux", "attach-session", "-t", name]);
  if (!r.ok) {
    console.error(`${r.message}; attaching here instead.`);
    goto(name);
  }
}

// Shared by the dashboard loop and `gta go` (menubar clicks).
async function performAction(action: Action) {
  if (action.type === "attach") {
    await openSession(action.session);
  } else if (action.type === "focus") {
    const r = await focusTty(action.tty, action.app ?? "");
    if (!r.ok) console.error(r.message);
  } else if (action.type === "resume") {
    const e = action.entry;
    const name = tmux.createResume(e.cwd, e.kind, e.sessionId!);
    await openSession(name);
  }
}

// ── `gta go <key>` — perform the right action for a catalog entry by key ───────
if (argv[0] === "go") {
  requireTmux();
  const key = argv[1];
  const { catalog } = await import("./catalog.js");
  const e = (await catalog()).find((x) => x.key === key);
  if (!e) {
    console.error(`No agent with key ${key} (it may have ended).`);
    process.exit(1);
  }
  if (e.origin === "managed" && e.tmuxSession) await performAction({ type: "attach", session: e.tmuxSession });
  else if (e.origin === "external" && e.tty) await performAction({ type: "focus", tty: e.tty, app: e.app });
  else if (e.sessionId && e.cwd) await performAction({ type: "resume", entry: e });
  process.exit(0);
}

// ── `gta search <query>` — full-text search across all sessions ────────────────
if (argv[0] === "search") {
  const { searchSessions } = await import("./search.js");
  const query = argv.slice(1).join(" ");
  const hits = searchSessions(query, 40);
  if (hits.length === 0) {
    console.error(query ? `No sessions matching “${query}”.` : "Usage: gta search <query>");
    process.exit(hits.length === 0 && query ? 0 : 1);
  }
  for (const h of hits) {
    const proj = h.cwd.split("/").pop() || h.cwd;
    console.log(`${h.kind}\t${proj}\t×${h.matches}\t${h.task ?? ""}`);
    if (h.snippet) console.log(`    … ${h.snippet}`);
    console.log(`    resume: gta go d:${h.id}`);
  }
  process.exit(0);
}

// ── `gta menubar` — SwiftBar/xbar plugin output ───────────────────────────────
if (argv[0] === "menubar") {
  const { catalog } = await import("./catalog.js");
  const { menubar } = await import("./menubar.js");
  const bun = process.execPath;
  const cli = join(here, "cli.tsx");
  console.log(menubar(await catalog(), bun, cli));
  process.exit(0);
}

// ── `gta watch` — headless monitor; desktop-notifies when an agent needs you ──
if (argv[0] === "watch") {
  requireTmux();
  const { catalog } = await import("./catalog.js");
  const tracker = new StatusTracker();
  const every = Number(argv[1]) || 3;
  console.error(`gta watch — notifying when an agent needs you (every ${every}s, Ctrl-C to stop)`);
  tracker.diff(await catalog()); // prime baseline without firing
  for (;;) {
    await sleep(every * 1000);
    let entries;
    try {
      entries = await catalog();
    } catch {
      continue;
    }
    for (const t of tracker.diff(entries)) {
      notifyTransition(t);
      const tag = t.kind === "needs-you" ? "▲ needs you" : "● finished";
      console.error(`[${new Date().toLocaleTimeString()}] ${tag}: ${t.entry.project}`);
    }
  }
}

// ── `gta --json` — machine-readable catalog ───────────────────────────────────
if (argv.includes("--json")) {
  const { catalog } = await import("./catalog.js");
  console.log(JSON.stringify(await catalog(), null, 2));
  process.exit(0);
}

// ── default: loop dashboard-child ⇄ tmux until quit ───────────────────────────
requireTmux();
if (!process.stdin.isTTY) {
  console.error("Go to Agents is interactive — run it in a real terminal (or use --json).");
  process.exit(1);
}

function showDashboard(): Action {
  const actionFile = join(tmpdir(), `gta-action-${process.pid}.json`);
  const r = spawnSync(process.execPath, [join(here, "dashboard.tsx"), actionFile], {
    stdio: "inherit",
  });
  try {
    const a = JSON.parse(readFileSync(actionFile, "utf8")) as Action;
    rmSync(actionFile, { force: true });
    if (process.env.GTA_DEBUG)
      appendFileSync("/tmp/gta-debug.log", `${new Date().toISOString()} ${JSON.stringify(a)}\n`);
    return a;
  } catch {
    if (r.status !== 0) console.error(`dashboard exited with status ${r.status}`);
    return { type: "quit" };
  }
}

while (true) {
  const action = showDashboard();
  if (action.type === "quit") break;
  await performAction(action);
}
