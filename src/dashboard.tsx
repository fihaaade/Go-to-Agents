#!/usr/bin/env bun
// The dashboard CHILD process. Ink (raw-mode stdin, active readers) lives and
// DIES here — when this process exits, its stdin readers die with it, leaving
// the parent a clean terminal to hand to `tmux attach`. (Running Ink and tmux
// in the same process corrupts the tty under Bun even after setRawMode(false).)
import React from "react";
import { writeFileSync } from "node:fs";
import { render } from "ink";
import App, { type Action } from "./app.js";

const actionFile = process.argv[2];
if (!actionFile) {
  console.error("dashboard: missing action-file argument");
  process.exit(2);
}

let chosen: Action = { type: "quit" };
const app = render(<App onChoose={(a) => (chosen = a)} />);
await app.waitUntilExit();
writeFileSync(actionFile, JSON.stringify(chosen));
process.exit(0);
