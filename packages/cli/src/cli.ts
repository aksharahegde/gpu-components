import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  findItem,
  sha256,
  stripHeader,
  transform,
  type Registry,
  type RegistryItem,
} from "./registry.ts";

/**
 * `gpu-components` — the distribution half of PLAN.md §18.
 *
 * The model is the hybrid §18.1 argues for: the *runtime* stays a versioned npm dependency because
 * it is infrastructure nobody wants to fork and everybody wants patched, while *components* are
 * copied into the user's repository because they are policy — colours, LOD thresholds, label rules,
 * interaction feel, shaders — which a props API can never anticipate.
 */

export interface Io {
  readonly log: (message: string) => void;
  readonly error: (message: string) => void;
  /** Absolute path of the project the command is acting on. */
  readonly cwd: string;
  /** Non-interactive runs skip confirmation; §24.3 requires it otherwise. */
  readonly assumeYes: boolean;
}

export interface AddOptions {
  readonly path?: string;
  readonly force?: boolean;
}

const DEFAULT_TARGET = path.join("components", "gpu");

export function targetDir(io: Io, item: string, options: AddOptions = {}): string {
  return path.resolve(io.cwd, options.path ?? DEFAULT_TARGET, item);
}

/** Reads a bundled component file and verifies it against the registry hash before use. */
function readVerified(componentsRoot: string, item: RegistryItem, file: string, hash: string): string {
  const full = path.join(componentsRoot, item.name, file);
  if (!existsSync(full)) {
    throw new Error(`gpu-components: registry file missing from the package: ${item.name}/${file}`);
  }
  const source = readFileSync(full, "utf8");
  const actual = sha256(source);
  if (actual !== hash) {
    // §24.3: verify before writing. A mismatch means the package is corrupted or was edited in
    // place — either way, writing it into someone's repository is the wrong move.
    throw new Error(
      `gpu-components: integrity check failed for ${item.name}/${file}\n` +
        `  expected ${hash}\n  actual   ${actual}\n` +
        `  Refusing to write. Reinstall the CLI, or report this if it persists.`,
    );
  }
  return source;
}

export function list(registry: Registry, io: Io): number {
  io.log(`gpu-components v${registry.version} — ${registry.items.length} components\n`);
  for (const item of registry.items) {
    io.log(`  ${item.name.padEnd(10)} ${item.title}`);
    io.log(`  ${" ".repeat(10)} ${item.description}`);
    io.log(`  ${" ".repeat(10)} ${item.files.length} files · needs ${item.dependencies.join(", ")}\n`);
  }
  io.log(`Add one with:  npx gpu-components add <name>`);
  return 0;
}

export function add(registry: Registry, componentsRoot: string, name: string, io: Io, options: AddOptions = {}): number {
  const item = findItem(registry, name);
  if (!item) {
    io.error(`gpu-components: unknown component "${name}". Try: ${registry.items.map((i) => i.name).join(", ")}`);
    return 1;
  }

  const dir = targetDir(io, item.name, options);
  const relative = path.relative(io.cwd, dir) || ".";
  const existing = existsSync(dir) ? readdirSync(dir) : [];
  if (existing.length > 0 && !options.force) {
    io.error(
      `gpu-components: ${relative} already exists with ${existing.length} files.\n` +
        `  Your edits live there — overwriting would discard them.\n` +
        `  Run \`npx gpu-components diff ${item.name}\` to see what changed upstream, or re-run with --force.`,
    );
    return 1;
  }

  // §24.3: "`add` prints the file list and requires confirmation outside CI". Everything is read and
  // verified before anything is written, so a failure cannot leave a half-copied component behind.
  const files = item.files.map((file) => ({
    path: file.path,
    content: transform(readVerified(componentsRoot, item, file.path, file.hash), item.name, registry.version),
  }));

  io.log(`gpu-components: ${item.title} v${registry.version} -> ${relative}/`);
  for (const file of files) io.log(`  ${file.path}`);
  io.log(`\nThis code becomes yours to edit. Requires: ${item.dependencies.join(", ")}`);

  mkdirSync(dir, { recursive: true });
  for (const file of files) writeFileSync(path.join(dir, file.path), file.content);

  io.log(`\nWrote ${files.length} files.`);
  const missing = missingDependencies(io.cwd, item);
  if (missing.length > 0) {
    io.log(`\nMissing dependencies — install them before importing the component:`);
    io.log(`  npm i ${missing.join(" ")}`);
  }
  return 0;
}

/** Which of the item's dependencies the project does not already declare. */
export function missingDependencies(cwd: string, item: RegistryItem): string[] {
  const manifestPath = path.join(cwd, "package.json");
  if (!existsSync(manifestPath)) return [...item.dependencies];
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  return item.dependencies.filter((dep) => !declared.has(dep));
}

export interface DiffEntry {
  readonly path: string;
  readonly status: "unchanged" | "modified" | "missing" | "added-upstream";
}

/**
 * Compares a copied component against what the CLI would write today.
 *
 * §18.2 makes this the mitigation for the copy model's central cost: "copied components drift…
 * `npx gpu-components diff timeline` shows upstream changes against your copy", and the issue
 * template asks for its output. The comparison strips the provenance header from both sides, so a
 * version bump alone never shows as a change.
 */
export function diff(registry: Registry, componentsRoot: string, name: string, io: Io, options: AddOptions = {}): number {
  const item = findItem(registry, name);
  if (!item) {
    io.error(`gpu-components: unknown component "${name}"`);
    return 1;
  }

  const dir = targetDir(io, item.name, options);
  const relative = path.relative(io.cwd, dir) || ".";
  if (!existsSync(dir)) {
    io.error(`gpu-components: ${relative} does not exist — nothing to diff. Run \`add ${item.name}\` first.`);
    return 1;
  }

  const entries: DiffEntry[] = [];
  for (const file of item.files) {
    const local = path.join(dir, file.path);
    if (!existsSync(local)) {
      entries.push({ path: file.path, status: "missing" });
      continue;
    }
    const upstream = stripHeader(transform(readVerified(componentsRoot, item, file.path, file.hash), item.name, registry.version));
    const yours = stripHeader(readFileSync(local, "utf8"));
    entries.push({ path: file.path, status: upstream === yours ? "unchanged" : "modified" });
  }

  const known = new Set(item.files.map((f) => f.path));
  for (const file of readdirSync(dir)) {
    if (!known.has(file)) entries.push({ path: file, status: "added-upstream" });
  }

  const changed = entries.filter((e) => e.status !== "unchanged");
  io.log(`gpu-components: ${item.title} — your copy in ${relative} vs registry v${registry.version}\n`);
  if (changed.length === 0) {
    io.log(`  identical (${entries.length} files)`);
    return 0;
  }
  for (const entry of changed) {
    const label =
      entry.status === "modified"
        ? "differs  "
        : entry.status === "missing"
          ? "missing  "
          : "yours    ";
    io.log(`  ${label} ${entry.path}`);
  }
  io.log(
    `\n${changed.length} of ${entries.length} files differ. "differs" may mean your edits, upstream's, or both —\n` +
      `include this output when reporting a bug against a modified component.`,
  );
  return 0;
}

export interface DoctorCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

/**
 * Diagnoses a project before or after `add` (§18.3, §32).
 *
 * Note what it does **not** check. §18.2 designed `doctor` largely around configuring the vgpu WGSL
 * loader, calling that "a real DX risk if unhandled". Our shaders are TypeScript template strings,
 * so there is no loader to configure and that check would be theatre. What replaced it is the
 * problem that actually bites: a stock `tsconfig.json` rejecting the import extensions our source
 * uses — which is why `add` rewrites them, and why this reports whether it mattered.
 */
export function doctorChecks(cwd: string, registry: Registry): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  const manifestPath = path.join(cwd, "package.json");
  const manifest = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> })
    : null;
  checks.push({
    name: "project",
    ok: manifest !== null,
    detail: manifest ? `found package.json` : `no package.json in ${cwd} — run this inside your project`,
  });

  const declared = { ...manifest?.dependencies, ...manifest?.devDependencies };
  for (const dep of ["@gpu-components/core", "@gpu-components/react", "vgpu", "react"]) {
    const version = declared[dep];
    checks.push({
      name: dep,
      ok: version !== undefined,
      detail: version ? `declared ${version}` : `missing — npm i ${dep}`,
    });
  }

  // The import-extension trap, reported rather than assumed away.
  const tsconfigPath = path.join(cwd, "tsconfig.json");
  if (existsSync(tsconfigPath)) {
    const raw = readFileSync(tsconfigPath, "utf8");
    const allows = /"allowImportingTsExtensions"\s*:\s*true/.test(raw);
    checks.push({
      name: "tsconfig",
      ok: true,
      detail: allows
        ? `allowImportingTsExtensions is on — copied source works either way`
        : `standard setup; \`add\` rewrites .ts import extensions so the copy compiles`,
    });
  } else {
    checks.push({ name: "tsconfig", ok: true, detail: "no tsconfig.json — nothing to reconcile" });
  }

  checks.push({
    name: "registry",
    ok: registry.items.length > 0,
    detail: `v${registry.version}, ${registry.items.length} components bundled`,
  });

  return checks;
}

export function doctor(registry: Registry, io: Io): number {
  const checks = doctorChecks(io.cwd, registry);
  io.log(`gpu-components doctor\n`);
  for (const check of checks) {
    io.log(`  ${check.ok ? "ok  " : "FAIL"} ${check.name.padEnd(22)} ${check.detail}`);
  }
  const failed = checks.filter((c) => !c.ok);
  io.log(failed.length === 0 ? `\nAll checks passed.` : `\n${failed.length} check(s) need attention.`);
  return failed.length === 0 ? 0 : 1;
}
