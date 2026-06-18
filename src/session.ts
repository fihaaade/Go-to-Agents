// Reads Claude / Codex session JSONL stores: resolve a cwd to its live session,
// and enumerate recent (dormant) sessions that can be resumed.
import { homedir } from "node:os";
import { join } from "node:path";
import { readdirSync, statSync, readFileSync } from "node:fs";

const HOME = homedir();
export type AgentKind = "claude" | "codex";

export interface SessionInfo {
  file?: string;
  id?: string;
  lastActivity?: number; // epoch ms (file mtime)
  task?: string;
}

export interface DormantSession {
  kind: AgentKind;
  file: string;
  id: string;
  cwd: string;
  lastActivity: number;
  task?: string;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 80);
}

// ── claude ───────────────────────────────────────────────────────────────────
function claudeProjectsRoot() {
  return join(HOME, ".claude", "projects");
}

function newestJsonl(dir: string): { file: string; mtime: number } | null {
  let best: { file: string; mtime: number } | null = null;
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".jsonl")) continue;
      const file = join(dir, name);
      const mtime = statSync(file).mtimeMs;
      if (!best || mtime > best.mtime) best = { file, mtime };
    }
  } catch {
    /* dir may not exist yet */
  }
  return best;
}

// Claude events carry a literal "cwd" field — the encoded dir name is ambiguous
// ('-' may be '/' or '.'), so always read cwd from content.
function claudeCwdOf(file: string): string | undefined {
  try {
    const m = readFileSync(file, "utf8").match(/"cwd":"((?:[^"\\]|\\.)*)"/);
    if (m) return JSON.parse(`"${m[1]}"`);
  } catch {
    /* ignore */
  }
  return undefined;
}

function claudeTaskOf(file: string): string | undefined {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      const c = ev?.message?.content;
      if (ev?.type === "user" && typeof c === "string" && !c.startsWith("<")) return oneLine(c);
      if (ev?.type === "user" && Array.isArray(c)) {
        const t = c.find((p: any) => p?.type === "text")?.text;
        if (t && !t.startsWith("<")) return oneLine(t);
      }
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

// ── codex ────────────────────────────────────────────────────────────────────
// ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl with session_meta.payload.{id,cwd}.
function codexRecentFiles(maxFiles = 40): Array<{ file: string; mtime: number }> {
  const root = join(HOME, ".codex", "sessions");
  const out: Array<{ file: string; mtime: number }> = [];
  try {
    for (const y of readdirSync(root).sort().reverse().slice(0, 2))
      for (const m of readdirSync(join(root, y)).sort().reverse().slice(0, 3))
        for (const d of readdirSync(join(root, y, m)).sort().reverse().slice(0, 5))
          for (const name of readdirSync(join(root, y, m, d))) {
            if (!name.endsWith(".jsonl")) continue;
            const file = join(root, y, m, d, name);
            out.push({ file, mtime: statSync(file).mtimeMs });
          }
  } catch {
    return [];
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, maxFiles);
}

function codexMeta(file: string): { id?: string; cwd?: string } {
  try {
    const meta = JSON.parse(readFileSync(file, "utf8").split("\n")[0]);
    return { id: meta?.payload?.id, cwd: meta?.payload?.cwd };
  } catch {
    return {};
  }
}

function codexTaskOf(file: string): string | undefined {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      if (ev?.payload?.role === "user" && typeof ev?.payload?.content === "string")
        return oneLine(ev.payload.content);
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

// ── public API ───────────────────────────────────────────────────────────────
/** The live session for a running agent, resolved from its working directory. */
export function resolveSession(kind: AgentKind, cwd: string): SessionInfo {
  if (kind === "claude") {
    const sess = newestJsonl(join(claudeProjectsRoot(), cwd.replace(/[/.]/g, "-")));
    if (!sess) return {};
    return {
      file: sess.file,
      id: (sess.file.split("/").pop() || "").replace(/\.jsonl$/, ""),
      lastActivity: sess.mtime,
      task: claudeTaskOf(sess.file),
    };
  }
  for (const r of codexRecentFiles()) {
    const meta = codexMeta(r.file);
    if (meta.cwd === cwd)
      return { file: r.file, id: meta.id, lastActivity: r.mtime, task: codexTaskOf(r.file) };
  }
  return {};
}

/** Recent sessions across all projects, newest first — candidates for resume. */
export function listDormant(limit = 12): DormantSession[] {
  const out: DormantSession[] = [];

  try {
    for (const dir of readdirSync(claudeProjectsRoot())) {
      const full = join(claudeProjectsRoot(), dir);
      let names: string[] = [];
      try {
        names = readdirSync(full).filter((n) => n.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const name of names) {
        const file = join(full, name);
        const mtime = statSync(file).mtimeMs;
        out.push({
          kind: "claude",
          file,
          id: name.replace(/\.jsonl$/, ""),
          cwd: "", // filled lazily below for the survivors only (cwd needs a file read)
          lastActivity: mtime,
        });
      }
    }
  } catch {
    /* no claude store */
  }

  for (const r of codexRecentFiles()) {
    const meta = codexMeta(r.file);
    if (!meta.id) continue;
    out.push({
      kind: "codex",
      file: r.file,
      id: meta.id,
      cwd: meta.cwd ?? "",
      lastActivity: r.mtime,
    });
  }

  out.sort((a, b) => b.lastActivity - a.lastActivity);
  const top = out.slice(0, limit);
  for (const s of top) {
    if (s.kind === "claude") {
      s.cwd = claudeCwdOf(s.file) ?? "";
      s.task = claudeTaskOf(s.file);
    } else {
      s.task = codexTaskOf(s.file);
    }
  }
  // Sessions with no cwd or no real user content aren't resumable in any useful way.
  return top.filter((s) => s.cwd && s.task);
}

// Describe a single session file by path (used by full-text search). Kind is
// inferred from the path: codex lives under ~/.codex/sessions.
export function describeFile(file: string): DormantSession | null {
  try {
    const lastActivity = statSync(file).mtimeMs;
    if (file.includes("/.codex/sessions/")) {
      const meta = codexMeta(file);
      if (!meta.id) return null;
      return {
        kind: "codex",
        file,
        id: meta.id,
        cwd: meta.cwd ?? "",
        lastActivity,
        task: codexTaskOf(file),
      };
    }
    return {
      kind: "claude",
      file,
      id: (file.split("/").pop() || "").replace(/\.jsonl$/, ""),
      cwd: claudeCwdOf(file) ?? "",
      lastActivity,
      task: claudeTaskOf(file),
    };
  } catch {
    return null;
  }
}

export const CLAUDE_PROJECTS_ROOT = claudeProjectsRoot();
export const CODEX_SESSIONS_ROOT = join(HOME, ".codex", "sessions");
