import React, { useEffect, useState, useCallback, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { catalog, type Entry, type Status, type Origin } from "./catalog.js";
import { kill } from "./tmux.js";
import { StatusTracker, notifyTransition } from "./notify.js";
import { searchSessions, type SearchHit } from "./search.js";

type Mode = "list" | "searching" | "results";

function hitToEntry(h: SearchHit, now: number): Entry {
  return {
    key: `s:${h.id}`,
    origin: "dormant",
    kind: h.kind,
    cwd: h.cwd,
    project: h.cwd.split("/").pop() || h.cwd,
    task: h.task || h.snippet,
    lastActivity: h.lastActivity,
    idleSeconds: Math.max(0, Math.round((now - h.lastActivity) / 1000)),
    status: "idle",
    sessionId: h.id,
  };
}

const REFRESH_MS = 2000;
const GLYPH: Record<Status, string> = { working: "●", waiting: "▲", idle: "○" };
const COLOR: Record<Status, string> = { working: "green", waiting: "yellow", idle: "gray" };
const ORIGIN_TAG: Record<Origin, { label: string; color: string }> = {
  managed: { label: "tmux", color: "cyan" },
  external: { label: "term", color: "magenta" },
  dormant: { label: "zzz ", color: "gray" },
};

export type Action =
  | { type: "quit" }
  | { type: "attach"; session: string }
  | { type: "focus"; tty: string; app?: string }
  | { type: "resume"; entry: Entry };

function rel(s: number): string {
  if (s >= 999_999) return "—";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
function homeShort(p: string): string {
  const h = process.env.HOME ?? "";
  return h && p.startsWith(h) ? "~" + p.slice(h.length) : p;
}
// Display-width-aware padding: CJK characters occupy two terminal columns, so
// counting code points misaligns and wraps rows containing Chinese text.
function chWidth(cp: number): number {
  return (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
    ? 2
    : 1;
}
// Render text in Unicode Bold Fraktur (blackletter / "gothic") — a contiguous,
// hole-free block, so plain codepoint math covers every letter. Falls back to
// plain text via GTA_PLAIN_TITLE for fonts that lack the glyphs.
function gothic(s: string): string {
  if (process.env.GTA_PLAIN_TITLE) return s;
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c >= 65 && c <= 90) out += String.fromCodePoint(0x1d56c + (c - 65));
    else if (c >= 97 && c <= 122) out += String.fromCodePoint(0x1d586 + (c - 97));
    else out += ch;
  }
  return out;
}

// The title on its own line. Tight letters, words kept apart — minimal spacing.
const TITLE = gothic("Go to Agents");

function strWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += chWidth(ch.codePointAt(0)!);
  return w;
}
function pad(s: string, n: number): string {
  const total = strWidth(s);
  if (total <= n) return s + " ".repeat(n - total);
  let w = 0;
  let out = "";
  for (const ch of s) {
    const cw = chWidth(ch.codePointAt(0)!);
    if (w + cw > n - 1) break; // reserve 1 col for the ellipsis
    out += ch;
    w += cw;
  }
  return out + "…" + " ".repeat(n - w - 1);
}

function hintFor(e: Entry | undefined): string {
  if (!e) return "";
  if (e.origin === "managed") return "⏎ open in a new terminal window";
  if (e.origin === "external") return "⏎ focus its terminal window";
  return "⏎ resume in a new terminal window";
}

export default function App({ onChoose }: { onChoose: (a: Action) => void }) {
  const { exit } = useApp();
  const [entries, setEntries] = useState<Entry[]>([]);
  // Selection tracks the entry's key, not its row index: the list re-sorts on
  // refresh, and a position-based cursor would silently move to another agent
  // right as the user hits ⏎.
  //
  // The authoritative cursor lives in refs and updates SYNCHRONOUSLY: multiple
  // key events can fire within one React tick (fast typing, chunked input), and
  // state-based reads would all see the same stale selection — ⏎ after quick
  // j-presses would then act on the wrong row. State only mirrors for render.
  const entriesRef = useRef<Entry[]>([]);
  const resultsRef = useRef<Entry[]>([]);
  const selKeyRef = useRef<string | null>(null);
  const modeRef = useRef<Mode>("list");
  const queryRef = useRef("");
  const tracker = useRef(new StatusTracker());
  const [entriesState, setEntriesState] = useState<Entry[]>([]);
  const [resultsState, setResultsState] = useState<Entry[]>([]);
  const [selKey, setSelKey] = useState<string | null>(null);
  const [mode, setModeState] = useState<Mode>("list");
  const [query, setQueryState] = useState("");
  const [flash, setFlash] = useState("");
  const [loading, setLoading] = useState(true);

  const setMode = (m: Mode) => {
    modeRef.current = m;
    setModeState(m);
  };
  const setQuery = (q: string) => {
    queryRef.current = q;
    setQueryState(q);
  };
  // Whichever list is currently on screen.
  const view = () => (modeRef.current === "results" ? resultsRef.current : entriesRef.current);

  const refresh = useCallback(async () => {
    try {
      const next = await catalog();
      for (const t of tracker.current.diff(next)) notifyTransition(t);
      entriesRef.current = next;
      setEntriesState(next);
      if (modeRef.current === "list") {
        if (!next.some((e) => e.key === selKeyRef.current))
          selKeyRef.current = next[0]?.key ?? null;
        setSelKey(selKeyRef.current);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const selIndex = () => {
    const v = view();
    const i = v.findIndex((e) => e.key === selKeyRef.current);
    return i < 0 ? 0 : i;
  };
  const move = (delta: number) => {
    const v = view();
    if (v.length === 0) return;
    const next = Math.min(v.length - 1, Math.max(0, selIndex() + delta));
    selKeyRef.current = v[next].key;
    setSelKey(v[next].key);
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const quit = () => {
    onChoose({ type: "quit" });
    exit();
  };
  const enterSel = () => {
    const e = view()[selIndex()];
    if (!e) return;
    if (e.origin === "managed" && e.tmuxSession) {
      onChoose({ type: "attach", session: e.tmuxSession });
      exit();
    } else if (e.origin === "external" && e.tty) {
      onChoose({ type: "focus", tty: e.tty, app: e.app });
      exit();
    } else if (e.origin === "dormant" && e.sessionId && e.cwd) {
      onChoose({ type: "resume", entry: e });
      exit();
    }
  };
  const killSel = () => {
    const e = view()[selIndex()];
    if (e?.origin === "managed" && e.tmuxSession) {
      kill(e.tmuxSession);
      refresh();
    } else if (e) setFlash("x only kills gta-managed sessions");
  };

  const startSearch = () => {
    if (modeRef.current === "list") setQuery(""); // fresh query; refine keeps it
    setFlash("");
    setMode("searching");
  };
  const backToList = () => {
    selKeyRef.current = entriesRef.current[0]?.key ?? null;
    setSelKey(selKeyRef.current);
    setMode("list");
  };
  const runSearch = () => {
    const q = queryRef.current.trim();
    if (!q) return setMode("list");
    const now = Date.now();
    const hits = searchSessions(q, 50).map((h) => hitToEntry(h, now));
    resultsRef.current = hits;
    setResultsState(hits);
    selKeyRef.current = hits[0]?.key ?? null;
    setSelKey(selKeyRef.current);
    setFlash(hits.length ? "" : `no sessions matching “${q}”`);
    setMode("results");
  };

  useInput((input, key) => {
    if (key.ctrl && input === "c") return quit();

    if (modeRef.current === "searching") {
      if (key.escape) return setMode("list");
      if (key.return) return runSearch();
      if (key.backspace || key.delete) return setQuery(queryRef.current.slice(0, -1));
      const arrow = key.upArrow || key.downArrow || key.leftArrow || key.rightArrow;
      if (input && !arrow && !key.tab) setQuery(queryRef.current + input);
      return;
    }

    // list / results
    if (key.escape) return modeRef.current === "results" ? backToList() : undefined;
    if (key.return && (input === "" || input === "\r")) return enterSel();
    if (key.upArrow) return move(-1);
    if (key.downArrow) return move(1);
    for (const ch of input) {
      if (ch === "q") return quit();
      if (ch === "/") return startSearch();
      if (ch === "k") move(-1);
      else if (ch === "j") move(1);
      else if (ch === "r") {
        if (modeRef.current === "list") refresh();
      } else if (ch === "x") {
        if (modeRef.current === "list") killSel();
      } else if (ch === "\r") enterSel();
    }
  });

  const live = entriesState.filter((e) => e.origin !== "dormant").length;
  const dormant = entriesState.length - live;
  const rows = mode === "results" ? resultsState : entriesState;
  const sel = Math.max(0, rows.findIndex((e) => e.key === selKey));

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyanBright">
          {TITLE}
        </Text>
        {mode === "list" ? (
          <Text color="gray">
            {live} live · {dormant} resumable · refresh {REFRESH_MS / 1000}s · / search
          </Text>
        ) : (
          <Text color="gray">
            search: <Text color="whiteBright">{query || "…"}</Text>
            {mode === "searching" ? <Text color="cyanBright">▏</Text> : ` · ${rows.length} results`}
          </Text>
        )}
      </Box>

      <Box>
        <Text color="gray" dimColor>
          {"    "}
          {pad("VIA", 5)} {pad("AGENT", 7)} {pad("TASK", 32)} {pad("PROJECT", 22)} IDLE
        </Text>
      </Box>

      {loading && entriesState.length === 0 ? (
        <Text color="gray">scanning…</Text>
      ) : mode === "searching" ? (
        <Text color="gray">type a query, then ⏎ to search all sessions</Text>
      ) : rows.length === 0 ? (
        <Text color="yellow">
          {mode === "results" ? "No matches." : "Nothing running and no recent sessions found."}
        </Text>
      ) : (
        rows.map((e, i) => {
          const active = i === sel;
          const tag = ORIGIN_TAG[e.origin];
          return (
            <Box key={e.key}>
              <Text color={active ? "cyanBright" : undefined}>{active ? "▶ " : "  "}</Text>
              <Text color={COLOR[e.status]}>{GLYPH[e.status]} </Text>
              <Text color={tag.color}>{pad(tag.label, 5)}</Text>
              <Text
                color={active ? "whiteBright" : e.origin === "dormant" ? "gray" : undefined}
                backgroundColor={active ? "blue" : undefined}
              >
                {" "}
                {pad(e.kind, 7)} {pad(e.task ?? "—", 32)} {pad(homeShort(e.cwd), 22)}{" "}
                {rel(e.idleSeconds)}
              </Text>
            </Box>
          );
        })
      )}

      <Box marginTop={1} flexDirection="column">
        {mode === "searching" ? (
          <Text color="gray">⏎ search · Esc cancel</Text>
        ) : mode === "results" ? (
          <Text color="gray">
            ↑/↓ · <Text color="cyanBright">⏎ resume in a new window</Text> · / refine · Esc back
          </Text>
        ) : (
          <>
            <Text color="gray">
              <Text color="green">●</Text> working <Text color="yellow">▲</Text> needs you{" "}
              <Text color="gray">○</Text> idle
            </Text>
            <Text color="gray">
              ↑/↓ · <Text color="cyanBright">{hintFor(rows[sel])}</Text> · / search · x kill · r
              refresh · q quit
            </Text>
          </>
        )}
        {flash ? <Text color="magentaBright">{flash}</Text> : null}
      </Box>
    </Box>
  );
}
