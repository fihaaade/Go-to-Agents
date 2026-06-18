// The unified agent catalog: one list, three origins.
//   managed  — running in a gta tmux session  → ⏎ attaches (exact, any terminal)
//   external — running, started outside gta   → ⏎ focuses its terminal (best-effort)
//   dormant  — not running, recent session    → ⏎ resumes it into a managed session
import { basename } from "node:path";
import * as tmux from "./tmux.js";
import { scanExternal } from "./scan.js";
import { listDormant, type AgentKind } from "./session.js";

export type Origin = "managed" | "external" | "dormant";
export type Status = "working" | "waiting" | "idle";

export interface Entry {
  key: string; // stable list key
  origin: Origin;
  kind: AgentKind;
  cwd: string;
  project: string;
  task?: string;
  lastActivity?: number;
  idleSeconds: number;
  status: Status;
  // origin-specific handles
  tmuxSession?: string; // managed
  pid?: number; // managed | external
  tty?: string; // external
  app?: string; // external (owning terminal app)
  sessionId?: string; // all (resume target for dormant)
}

function idleOf(lastActivity: number | undefined, now: number): number {
  return lastActivity ? Math.max(0, Math.round((now - lastActivity) / 1000)) : 999_999;
}

function statusOf(origin: Origin, idleSeconds: number): Status {
  if (origin === "dormant") return "idle";
  return idleSeconds < 8 ? "working" : "idle";
}

export async function catalog(): Promise<Entry[]> {
  const now = Date.now();
  const [managed, external] = await Promise.all([tmux.list(), scanExternal()]);

  const entries: Entry[] = [];
  const liveSessionIds = new Set<string>();
  const liveCwds = new Set<string>();
  // A managed agent owns its session id. During a resumed agent's first seconds
  // it is still named "claude" on its tmux pane tty, so the external scan can
  // briefly pick it up too — drop those so it never double-lists.
  const managedSessionIds = new Set<string>();

  for (const a of managed) {
    if (a.session_info.id) {
      liveSessionIds.add(a.session_info.id);
      managedSessionIds.add(a.session_info.id);
    }
    liveCwds.add(a.cwd);
    entries.push({
      key: `m:${a.session}`,
      origin: "managed",
      kind: a.kind,
      cwd: a.cwd,
      project: a.project,
      task: a.task,
      lastActivity: a.lastActivity,
      idleSeconds: a.idleSeconds,
      status: a.status, // ground-truth from the pane (working / waiting / idle)
      tmuxSession: a.session,
      pid: a.pid,
      sessionId: a.session_info.id,
    });
  }

  for (const a of external) {
    // Skip an external sighting of an agent gta already manages in tmux.
    if (a.session.id && managedSessionIds.has(a.session.id)) continue;
    if (a.session.id) liveSessionIds.add(a.session.id);
    liveCwds.add(a.cwd);
    const idleSeconds = idleOf(a.session.lastActivity, now);
    entries.push({
      key: `e:${a.pid}`,
      origin: "external",
      kind: a.kind,
      cwd: a.cwd,
      project: a.cwd === "?" ? "?" : basename(a.cwd),
      task: a.session.task,
      lastActivity: a.session.lastActivity,
      idleSeconds,
      status: statusOf("external", idleSeconds),
      pid: a.pid,
      tty: a.tty,
      app: a.app,
      sessionId: a.session.id,
    });
  }

  // Dormant: skip anything already represented by a live agent. A running agent's
  // cwd also hides that project's older sessions only when ids match — a project
  // can legitimately have several distinct dormant sessions worth resuming.
  for (const s of listDormant(15)) {
    if (liveSessionIds.has(s.id)) continue;
    entries.push({
      key: `d:${s.id}`,
      origin: "dormant",
      kind: s.kind,
      cwd: s.cwd,
      project: basename(s.cwd),
      task: s.task,
      lastActivity: s.lastActivity,
      idleSeconds: idleOf(s.lastActivity, now),
      status: "idle",
      sessionId: s.id,
    });
  }

  // Live agents first (working before idle), then dormant by recency.
  const originRank: Record<Origin, number> = { managed: 0, external: 0, dormant: 1 };
  const statusRank: Record<Status, number> = { working: 0, waiting: 1, idle: 2 };
  entries.sort(
    (a, b) =>
      originRank[a.origin] - originRank[b.origin] ||
      statusRank[a.status] - statusRank[b.status] ||
      a.idleSeconds - b.idleSeconds,
  );
  return entries;
}
