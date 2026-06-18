// gta owns its agents as tmux sessions named `gta-<kind>-<slug>`.
// Because the agent's pty lives in tmux (not a terminal window), "go to" is a
// plain `tmux attach` that works identically in any terminal, on any host.
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename } from "node:path";
import { resolveSession, type AgentKind, type SessionInfo } from "./session.js";

const pexec = promisify(execFile);
const PREFIX = "gta-";

export type Status = "working" | "waiting" | "idle";

export interface Agent {
  session: string; // tmux session name
  kind: AgentKind;
  cwd: string;
  project: string;
  pid: number; // pane pid (the agent process)
  attached: boolean; // are you currently inside it
  tmuxActivity: number; // epoch ms of last pane output
  lastActivity?: number; // epoch ms from the session jsonl (more semantic)
  idleSeconds: number;
  status: Status;
  task?: string;
  session_info: SessionInfo;
}

export function installed(): boolean {
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Are we currently running inside a tmux client? (affects attach vs switch-client)
export function insideTmux(): boolean {
  return Boolean(process.env.TMUX);
}

function binFor(kind: AgentKind): string {
  try {
    return execFileSync("command", ["-v", kind], { shell: "/bin/zsh", encoding: "utf8" }).trim() || kind;
  } catch {
    return kind;
  }
}

function slugify(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "agent";
}

function existingNames(): Set<string> {
  try {
    const out = execFileSync("tmux", ["list-sessions", "-F", "#{session_name}"], { encoding: "utf8" });
    return new Set(out.split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
}

/** Create a detached agent session and return its name. */
export function create(cwd: string, kind: AgentKind, extraArgs: string[] = []): string {
  const taken = existingNames();
  const base = `${PREFIX}${kind}-${slugify(basename(cwd))}`;
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}-${i}`;
  // Run the agent directly as the pane process so the session ends when it exits.
  execFileSync("tmux", ["new-session", "-d", "-s", name, "-c", cwd, binFor(kind), ...extraArgs]);
  return name;
}

/** Resume a dormant session inside a managed tmux session; returns its name. */
export function createResume(cwd: string, kind: AgentKind, sessionId: string): string {
  const args = kind === "claude" ? ["--resume", sessionId] : ["resume", sessionId];
  return create(cwd, kind, args);
}

/** Args to hand the current terminal to a session (attach), or switch if already in tmux. */
export function gotoArgs(name: string): string[] {
  return insideTmux() ? ["switch-client", "-t", name] : ["attach-session", "-t", name];
}

export function kill(name: string): void {
  try {
    execFileSync("tmux", ["kill-session", "-t", name]);
  } catch {
    /* already gone */
  }
}

// Ground-truth status from the agent's actual screen (works for Claude & Codex).
function capturePane(session: string): string {
  try {
    return execFileSync("tmux", ["capture-pane", "-p", "-t", session], { encoding: "utf8" });
  } catch {
    return "";
  }
}

function classifyPane(text: string): Status {
  if (!text) return "idle";
  if (/\besc to interrupt\b/i.test(text)) return "working";
  // A blocking prompt: numbered choice box, or a confirm/permission line.
  if (/❯\s*1\.\s/.test(text) || /Enter to confirm|Do you want to proceed|Allow command\?/i.test(text))
    return "waiting";
  return "idle";
}

export async function list(): Promise<Agent[]> {
  let stdout = "";
  try {
    ({ stdout } = await pexec("tmux", [
      "list-panes",
      "-a",
      "-F",
      "#{session_name}\t#{pane_pid}\t#{pane_current_path}\t#{window_activity}\t#{session_attached}",
    ]));
  } catch {
    return []; // no server / no sessions
  }
  const now = Date.now();
  const agents: Agent[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.startsWith(PREFIX)) continue;
    const [session, pidStr, cwd, actStr, attStr] = line.split("\t");
    const kind: AgentKind = session.startsWith(`${PREFIX}codex-`) ? "codex" : "claude";
    const info = resolveSession(kind, cwd);
    const tmuxActivity = Number(actStr) * 1000;
    const lastActivity = info.lastActivity ?? tmuxActivity;
    const idleSeconds = Math.max(0, Math.round((now - lastActivity) / 1000));
    const attached = attStr === "1";
    agents.push({
      session,
      kind,
      cwd,
      project: basename(cwd) || cwd,
      pid: Number(pidStr),
      attached,
      tmuxActivity,
      lastActivity,
      idleSeconds,
      status: classifyPane(capturePane(session)),
      task: info.task,
      session_info: info,
    });
  }
  const rank: Record<Status, number> = { working: 0, waiting: 1, idle: 2 };
  agents.sort((a, b) => rank[a.status] - rank[b.status] || a.idleSeconds - b.idleSeconds);
  return agents;
}
