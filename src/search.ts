// Full-text search across every Claude + Codex session on disk.
// ripgrep finds the matching files fast (~190MB); we then read just those few
// to build a readable snippet + metadata.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  describeFile,
  CLAUDE_PROJECTS_ROOT,
  CODEX_SESSIONS_ROOT,
  type AgentKind,
} from "./session.js";

export interface SearchHit {
  kind: AgentKind;
  file: string;
  id: string;
  cwd: string;
  lastActivity: number;
  task?: string;
  matches: number;
  snippet: string;
}

function matchingFiles(query: string): string[] {
  try {
    const out = execFileSync(
      "rg",
      ["-l", "-i", "-F", "--glob", "*.jsonl", "--", query, CLAUDE_PROJECTS_ROOT, CODEX_SESSIONS_ROOT],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    return out.split("\n").filter(Boolean);
  } catch {
    return []; // rg exits 1 on no matches
  }
}

// Pull ~50 chars around the first match and strip JSON noise into a hint.
function snippetOf(text: string, query: string): { snippet: string; matches: number } {
  const hay = text.toLowerCase();
  const needle = query.toLowerCase();
  let i = hay.indexOf(needle);
  if (i < 0) return { snippet: "", matches: 0 };
  let matches = 0;
  for (let p = i; p >= 0; p = hay.indexOf(needle, p + needle.length)) matches++;
  const raw = text.slice(Math.max(0, i - 50), i + needle.length + 50);
  const clean = raw
    .replace(/\\[nrt"]/g, " ")
    .replace(/[{}\[\]"]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { snippet: clean, matches };
}

export function searchSessions(query: string, limit = 40): SearchHit[] {
  if (!query.trim()) return [];
  const hits: SearchHit[] = [];
  for (const file of matchingFiles(query)) {
    const meta = describeFile(file);
    if (!meta || !meta.cwd) continue;
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const { snippet, matches } = snippetOf(text, query);
    if (!matches) continue;
    hits.push({
      kind: meta.kind,
      file,
      id: meta.id,
      cwd: meta.cwd,
      lastActivity: meta.lastActivity,
      task: meta.task,
      matches,
      snippet,
    });
  }
  hits.sort((a, b) => b.lastActivity - a.lastActivity);
  return hits.slice(0, limit);
}
