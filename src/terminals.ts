// Best-effort jump to the terminal of an agent started outside gta.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const pexec = promisify(execFile);
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "focus.applescript");

export interface FocusResult {
  ok: boolean; // exact tab focused
  partial?: boolean; // only the app raised
  message: string;
}

export async function focusTty(tty: string, app = ""): Promise<FocusResult> {
  try {
    const { stdout } = await pexec("osascript", [SCRIPT, tty, app]);
    const r = stdout.trim();
    if (r.startsWith("ok:")) return { ok: true, message: `Focused ${r.slice(3)}` };
    if (r.startsWith("app:"))
      return { ok: false, partial: true, message: `Raised ${r.slice(4)} (exact tab not scriptable in this terminal)` };
    return { ok: false, message: "Could not locate this agent's terminal window" };
  } catch (e: any) {
    return { ok: false, message: e?.stderr?.trim() || e?.message || "osascript failed" };
  }
}
