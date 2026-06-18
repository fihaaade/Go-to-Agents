// Open a command in a NEW terminal window, so entering an agent doesn't take
// over the gta dashboard — the panel stays put as a hub.
//
// Opening a window is inherently per-OS and per-terminal: there is no portable
// API. This module isolates that surface behind openInNewWindow(); add Linux /
// Windows behaviour in the linux()/win32() branches without touching callers.
import { execFileSync, spawn } from "node:child_process";
import { platform } from "node:os";

export interface LaunchResult {
  ok: boolean;
  via?: string;
  message: string;
}

// User can force a specific terminal; otherwise we follow the one gta runs in.
const wanted = (process.env.GTA_TERMINAL || process.env.TERM_PROGRAM || "").toLowerCase();

function shJoin(argv: string[]): string {
  return argv
    .map((a) => (/^[A-Za-z0-9_./:=@%+-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`))
    .join(" ");
}

function spawnDetached(cmd: string, args: string[]) {
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.unref();
}

// ── macOS ─────────────────────────────────────────────────────────────────────
function appExists(name: string): boolean {
  try {
    execFileSync("osascript", ["-e", `id of app "${name}"`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function iterm(cmd: string): LaunchResult {
  execFileSync("osascript", [
    "-e",
    `tell application "iTerm2"
       set w to (create window with default profile)
       tell current session of w to write text ${JSON.stringify(cmd)}
       activate
     end tell`,
  ]);
  return { ok: true, via: "iTerm2", message: "Opened in a new iTerm window" };
}

function terminalApp(cmd: string): LaunchResult {
  execFileSync("osascript", [
    "-e",
    `tell application "Terminal"
       activate
       do script ${JSON.stringify(cmd)}
     end tell`,
  ]);
  return { ok: true, via: "Terminal", message: "Opened in a new Terminal window" };
}

function ghostty(argv: string[]): LaunchResult {
  // Ghostty has no AppleScript; `open -na … --args -e <argv>` runs a command in
  // a fresh window (verified). It provides its own terminfo, so tmux is happy.
  spawnDetached("open", ["-na", "Ghostty.app", "--args", "-e", ...argv]);
  return { ok: true, via: "Ghostty", message: "Opened in a new Ghostty window" };
}

function darwin(argv: string[]): LaunchResult {
  const cmd = shJoin(argv);
  if (wanted.includes("ghostty") && appExists("Ghostty")) return ghostty(argv);
  if (wanted.includes("iterm") && appExists("iTerm")) return iterm(cmd);
  if (wanted.includes("apple_terminal")) return terminalApp(cmd);
  // Warp and unknowns can't run a command on launch; fall back to a scriptable one.
  if (appExists("iTerm")) return iterm(cmd);
  if (appExists("Ghostty")) return ghostty(argv);
  return terminalApp(cmd);
}

// ── Linux (best-effort; most users live in tmux already) ──────────────────────
function linux(argv: string[]): LaunchResult {
  const cmd = shJoin(argv);
  const candidates: Array<[string, string[]]> = [
    [process.env.TERMINAL || "", ["-e", cmd]],
    ["x-terminal-emulator", ["-e", cmd]],
    ["gnome-terminal", ["--", ...argv]],
    ["konsole", ["-e", ...argv]],
    ["alacritty", ["-e", ...argv]],
    ["kitty", [...argv]],
    ["wezterm", ["start", "--", ...argv]],
    ["xterm", ["-e", cmd]],
  ];
  for (const [bin, args] of candidates) {
    if (!bin) continue;
    try {
      execFileSync("sh", ["-c", `command -v ${bin}`], { stdio: "ignore" });
      spawnDetached(bin, args);
      return { ok: true, via: bin, message: `Opened in ${bin}` };
    } catch {
      /* not installed; try next */
    }
  }
  return { ok: false, message: "No terminal emulator found — set $GTA_TERMINAL or $TERMINAL" };
}

// ── Windows (tmux only under WSL) ─────────────────────────────────────────────
function win32(argv: string[]): LaunchResult {
  try {
    spawnDetached("wt.exe", ["-w", "new", "wsl.exe", ...argv]);
    return { ok: true, via: "Windows Terminal", message: "Opened in Windows Terminal (WSL)" };
  } catch {
    return { ok: false, message: "Windows needs Windows Terminal + WSL for the tmux model" };
  }
}

export async function openInNewWindow(argv: string[]): Promise<LaunchResult> {
  try {
    switch (platform()) {
      case "darwin":
        return darwin(argv);
      case "linux":
        return linux(argv);
      case "win32":
        return win32(argv);
      default:
        return { ok: false, message: `Unsupported platform: ${platform()}` };
    }
  } catch (e: any) {
    return { ok: false, message: e?.stderr?.toString().trim() || e?.message || "failed to open window" };
  }
}
