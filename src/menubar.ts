// Renders the catalog as a SwiftBar / xbar plugin: a menu-bar summary plus a
// dropdown where each agent is clickable (runs `gta go <key>`).
import type { Entry, Status } from "./catalog.js";

const EMOJI: Record<Status, string> = { working: "🟢", waiting: "🟡", idle: "⚪️" };

function clean(s: string, max = 60): string {
  const t = s.replace(/[|\n]/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

// A clickable line that runs `gta go <key>` with no terminal window.
function goLine(label: string, bun: string, cli: string, key: string): string {
  return `${label} | bash="${bun}" param1="${cli}" param2="go" param3="${key}" terminal=false`;
}

export function menubar(entries: Entry[], bun: string, cli: string): string {
  const live = entries.filter((e) => e.origin !== "dormant");
  const dormant = entries.filter((e) => e.origin === "dormant");
  const waiting = live.filter((e) => e.status === "waiting").length;
  const working = live.filter((e) => e.status === "working").length;

  const out: string[] = [];

  // Menu-bar title: flag attention first.
  if (waiting > 0) out.push(`🤖 🟡${waiting} | color=orange`);
  else if (working > 0) out.push(`🤖 🟢${working}`);
  else out.push(`🤖 ${live.length}`);

  out.push("---");

  if (live.length === 0) {
    out.push("No live agents");
  } else {
    out.push(`Live agents (${live.length}) | size=11 color=gray`);
    for (const e of live) {
      const label = `${EMOJI[e.status]} ${clean(e.project, 24)} — ${clean(e.task ?? "—", 40)}`;
      out.push(goLine(label, bun, cli, e.key));
      out.push(`-- ${clean(e.cwd, 70)} | color=gray`);
    }
  }

  if (dormant.length > 0) {
    out.push("---");
    out.push("Resume recent | size=11 color=gray");
    for (const e of dormant.slice(0, 6)) {
      const label = `💤 ${clean(e.project, 24)} — ${clean(e.task ?? "—", 40)}`;
      out.push(goLine(label, bun, cli, e.key));
    }
  }

  out.push("---");
  out.push("Refresh | refresh=true");
  return out.join("\n");
}
