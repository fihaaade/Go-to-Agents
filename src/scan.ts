// Detects agents started OUTSIDE gta — a plain `claude`/`codex` typed into any
// terminal. Pure observation via ps/lsof; tmux-managed panes are excluded so
// gta's own agents aren't double-counted.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveSession, type AgentKind, type SessionInfo } from "./session.js";

const pexec = promisify(execFile);

export interface ExternalAgent {
  pid: number;
  kind: AgentKind;
  tty: string; // e.g. "ttys007"
  app?: string; // owning terminal app (iTerm2, Ghostty, …)
  cwd: string;
  session: SessionInfo;
}

function kindOf(command: string): AgentKind | null {
  const base = (command.trim().split(/\s+/)[0] ?? "").split("/").pop() ?? "";
  if (base === "claude") return "claude";
  if (base === "codex" && !/\bapp-server\b/.test(command)) return "codex";
  return null;
}

async function tmuxPaneTtys(): Promise<Set<string>> {
  try {
    const { stdout } = await pexec("tmux", ["list-panes", "-a", "-F", "#{pane_tty}"]);
    return new Set(stdout.split("\n").filter(Boolean).map((t) => t.replace("/dev/", "")));
  } catch {
    return new Set(); // no tmux server
  }
}

async function cwdsFor(pids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (pids.length === 0) return map;
  try {
    const { stdout } = await pexec("lsof", ["-a", "-p", pids.join(","), "-d", "cwd", "-Fpn"]);
    let cur = 0;
    for (const line of stdout.split("\n")) {
      if (line.startsWith("p")) cur = Number(line.slice(1));
      else if (line.startsWith("n") && cur) map.set(cur, line.slice(1));
    }
  } catch {
    /* lsof exits non-zero on partial results; lines above still parsed */
  }
  return map;
}

// tty -> owning GUI terminal app, via the PPID of the tty's session leader.
async function ownerApp(tty: string): Promise<string | undefined> {
  try {
    const { stdout } = await pexec("ps", ["-o", "pid=,ppid=,command=", "-t", tty]);
    const rows = stdout
      .split("\n")
      .map((l) => l.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/))
      .filter(Boolean) as RegExpMatchArray[];
    if (rows.length === 0) return undefined;
    const leader =
      rows.find((r) => /\blogin\b|-c exec/.test(r[3])) ??
      rows.sort((a, b) => Number(a[1]) - Number(b[1]))[0];
    const { stdout: comm } = await pexec("ps", ["-o", "comm=", "-p", leader[2]]);
    const m = comm.match(/\/([^/]+)\.app\//) ?? comm.match(/iTerm2?/);
    return m ? (m[1] ?? "iTerm2") : undefined;
  } catch {
    return undefined;
  }
}

export async function scanExternal(): Promise<ExternalAgent[]> {
  const [{ stdout }, managedTtys] = await Promise.all([
    pexec("ps", ["-axo", "pid=,tty=,command="]),
    tmuxPaneTtys(),
  ]);

  const procs: Array<{ pid: number; tty: string; kind: AgentKind }> = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const [, pidStr, tty, command] = m;
    if (!/^ttys\d+$/.test(tty) || managedTtys.has(tty)) continue;
    const kind = kindOf(command);
    if (kind) procs.push({ pid: Number(pidStr), tty, kind });
  }

  const cwds = await cwdsFor(procs.map((p) => p.pid));
  return Promise.all(
    procs.map(async (p) => {
      const cwd = cwds.get(p.pid) ?? "?";
      return {
        ...p,
        app: await ownerApp(p.tty),
        cwd,
        session: cwd === "?" ? {} : resolveSession(p.kind, cwd),
      };
    }),
  );
}
