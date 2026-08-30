#!/usr/bin/env node
/**
 * `npx gpu-components <command>` — PLAN.md §18.3's surface.
 *
 * Thin on purpose: argument parsing here, behaviour in `../src/cli.ts`, so every command is
 * testable without spawning a process or touching a real project.
 */
import { readFileSync, readSync, writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { add, diff, doctor, list } from "../src/cli.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const registry = JSON.parse(readFileSync(path.join(pkgRoot, "registry.json"), "utf8"));
const componentsRoot = path.join(pkgRoot, "components");

const argv = process.argv.slice(2);
const command = argv[0];
const positional = argv.slice(1).filter((a) => !a.startsWith("-"));
const flags = new Set(argv.filter((a) => a.startsWith("-")));
const pathFlagIndex = argv.indexOf("--path");
const targetPath = pathFlagIndex >= 0 ? argv[pathFlagIndex + 1] : undefined;

/**
 * Synchronous y/N prompt on the TTY.
 *
 * Sync so `add` stays a straight-line function that is trivial to test — the tests inject their own
 * `confirm`. A non-TTY stdin (a pipe, a CI runner without `CI=true`) answers "no" rather than
 * hanging or silently proceeding: refusing to write is the safe default.
 */
function promptYesNo(question) {
  if (!process.stdin.isTTY) return false;
  writeSync(1, `${question} [y/N] `);
  const buffer = Buffer.alloc(16);
  let bytes = 0;
  try {
    bytes = readSync(process.stdin.fd, buffer, 0, buffer.length, null);
  } catch {
    return false;
  }
  const answer = buffer.toString("utf8", 0, bytes).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

const io = {
  log: (message) => console.log(message),
  error: (message) => console.error(message),
  confirm: promptYesNo,
  cwd: process.cwd(),
  // Confirmation is required outside CI (§24.3); `--yes` and a CI environment both waive it.
  assumeYes: flags.has("--yes") || flags.has("-y") || process.env.CI === "true",
};

const options = { path: targetPath, force: flags.has("--force") };

function usage() {
  console.log(`gpu-components v${registry.version}

  npx gpu-components add <component> [--path <dir>] [--force]
  npx gpu-components diff <component> [--path <dir>]
  npx gpu-components doctor
  npx gpu-components list

The runtime (@gpu-components/core, @gpu-components/react) is an npm dependency you upgrade.
Components are copied into your repository and become yours to edit.`);
}

let code = 0;
switch (command) {
  case "add":
    code = positional[0] ? add(registry, componentsRoot, positional[0], io, options) : (usage(), 1);
    break;
  case "diff":
    code = positional[0] ? diff(registry, componentsRoot, positional[0], io, options) : (usage(), 1);
    break;
  case "doctor":
    code = doctor(registry, io);
    break;
  case "list":
    code = list(registry, io);
    break;
  default:
    usage();
    code = command === undefined || command === "--help" || command === "-h" ? 0 : 1;
}
process.exit(code);
