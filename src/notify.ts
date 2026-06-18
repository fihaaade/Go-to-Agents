// Desktop notifications + transition tracking for "which agent needs me now".
import { execFile } from "node:child_process";
import { platform } from "node:os";
import type { Entry, Status } from "./catalog.js";

export function notify(title: string, message: string, opts: { sound?: boolean } = {}): void {
  if (platform() !== "darwin") return; // TODO: linux notify-send, windows toast
  const sound = opts.sound ? ` sound name "Submarine"` : "";
  const script = `display notification ${q(message)} with title ${q(title)}${sound}`;
  execFile("osascript", ["-e", script], () => {});
}

function q(s: string): string {
  // AppleScript string literal: double-quoted, backslash-escaped.
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').slice(0, 200)}"`;
}

export type TransitionKind = "needs-you" | "finished";
export interface Transition {
  entry: Entry;
  kind: TransitionKind;
}

// Tracks each agent's previous status so we can fire on the moments that matter:
//   → waiting          : an agent hit a prompt and is blocked on you
//   working → idle      : an agent finished what it was doing
// The first time an agent is seen produces no event (no false alarm on startup).
export class StatusTracker {
  private prev = new Map<string, Status>();

  diff(entries: Entry[]): Transition[] {
    const events: Transition[] = [];
    const seen = new Set<string>();
    for (const e of entries) {
      seen.add(e.key);
      const p = this.prev.get(e.key);
      if (p !== undefined) {
        if (e.status === "waiting" && p !== "waiting") events.push({ entry: e, kind: "needs-you" });
        else if (p === "working" && e.status === "idle") events.push({ entry: e, kind: "finished" });
      }
      this.prev.set(e.key, e.status);
    }
    for (const k of [...this.prev.keys()]) if (!seen.has(k)) this.prev.delete(k);
    return events;
  }
}

export function notifyTransition(t: Transition): void {
  const e = t.entry;
  const what = e.task ? e.task : e.kind;
  if (t.kind === "needs-you") notify(`▲ ${e.project} needs you`, what, { sound: true });
  else notify(`● ${e.project} finished`, what);
}
