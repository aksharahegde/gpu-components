import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, type Dirent } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guards every WGSL template string against a stray backtick.
 *
 * This has broken the build **four** times: twice in `GPUGraph`, once in `GPUDataGrid`, once in
 * `GPUCandlestick`. The failure is always the same and always confusing — a backtick inside a
 * `/* wgsl *\/` template literal terminates the string early, so the error surfaces as
 * `ERR_INVALID_TYPESCRIPT_SYNTAX` pointing at a *comment*, with nothing obviously wrong on that line.
 *
 * The tempting habit is the cause: shader comments describe struct fields, and writing a field name
 * in backticks is what one does everywhere else in this codebase. Inside a WGSL literal it is a
 * syntax error waiting to happen.
 *
 * A one-off script was run by hand after the third occurrence and did not prevent the fourth,
 * because it was not part of the suite. This is.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

function wgslFiles(dir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return wgslFiles(full);
    return entry.name.endsWith(".wgsl.ts") ? [full] : [];
  });
}

describe("WGSL template literals", () => {
  it("finds the shader files it is supposed to be guarding", () => {
    const files = [...wgslFiles(path.join(repoRoot, "registry")), ...wgslFiles(path.join(repoRoot, "packages"))];
    // A guard that silently matches nothing is worse than no guard: it reports success forever.
    assert.ok(files.length >= 8, `expected to find the project's *.wgsl.ts files, found ${files.length}`);
  });

  it("contain no backticks", () => {
    const offenders: string[] = [];
    for (const dir of ["registry", "packages"]) {
      for (const file of wgslFiles(path.join(repoRoot, dir))) {
        const source = readFileSync(file, "utf8");
        // Each `/* wgsl */` marker is followed by a template literal; take what is inside it.
        for (const chunk of source.split("/* wgsl */").slice(1)) {
          const body = chunk.split("`")[1] ?? "";
          if (body.includes("`")) offenders.push(path.relative(repoRoot, file));
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `backtick inside a WGSL template literal (it terminates the string): ${offenders.join(", ")}`,
    );
  });

  it("declare a fragment or compute entry point in every shader", () => {
    // Cheap structural check: a *.wgsl.ts that exports no entry point is almost certainly truncated,
    // which is what a stray backtick produces when it happens to land mid-shader.
    for (const dir of ["registry", "packages"]) {
      for (const file of wgslFiles(path.join(repoRoot, dir))) {
        const source = readFileSync(file, "utf8");
        assert.ok(
          /@vertex|@fragment|@compute/.test(source),
          `${path.relative(repoRoot, file)} declares no shader entry point`,
        );
      }
    }
  });
});
