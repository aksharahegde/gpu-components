import { createHash } from "node:crypto";

/**
 * The registry format (PLAN.md §18.2: "we use the **standard shadcn `registry.json` schema** so our
 * components are installable by the existing `shadcn` CLI as well as ours, which removes a whole
 * adoption barrier").
 *
 * Every item carries a per-file SHA-256, which §24.3 requires: "every registry item ships a
 * SHA-256; the CLI verifies before writing". Here the registry ships *inside* the CLI package
 * rather than over HTTPS, so the hash is not defending against a hostile network — it defends
 * against a corrupted or hand-edited package, and it is the mechanism that lets `diff` tell
 * "upstream changed" apart from "you changed it".
 */

/** shadcn's `type` vocabulary. Ours are all `registry:component`. */
export type RegistryItemType = "registry:component" | "registry:lib" | "registry:hook";

export interface RegistryFile {
  /** Path relative to the item's target directory, e.g. `TimelineComponent.ts`. */
  readonly path: string;
  readonly type: RegistryItemType;
  /** SHA-256 of the file's *source* bytes, before any transform `add` applies. */
  readonly hash: string;
}

export interface RegistryItem {
  readonly name: string;
  readonly type: RegistryItemType;
  readonly title: string;
  readonly description: string;
  /** npm packages the copied source imports and the consuming project must have. */
  readonly dependencies: readonly string[];
  readonly files: readonly RegistryFile[];
}

export interface Registry {
  readonly $schema: string;
  readonly name: string;
  readonly homepage: string;
  /** The version stamped into copied files, so `diff` knows what the copy was taken from. */
  readonly version: string;
  readonly items: readonly RegistryItem[];
}

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function findItem(registry: Registry, name: string): RegistryItem | undefined {
  return registry.items.find((item) => item.name === name);
}

/**
 * Rewrites relative import specifiers to drop their `.ts` / `.tsx` extension.
 *
 * **This is the transform that makes copied source usable at all**, and it exists because of a real
 * incompatibility rather than a style preference. The registry sources import each other as
 * `./ingest.ts`, which Node's `--experimental-strip-types` test runner requires and which this repo
 * enables through `allowImportingTsExtensions` in `tsconfig.base.json`. A stock Vite or Next.js
 * project does not set that flag and rejects the import outright — so a straight file copy would
 * hand every user code that does not compile.
 *
 * Only *relative* specifiers are touched. Package imports (`@gpu-components/core`, `vgpu`, `react`)
 * are left exactly as they are.
 */
export function rewriteImportExtensions(source: string): string {
  return source.replace(
    /(\bfrom\s*|\bimport\s*\(\s*)(["'])(\.[^"']*?)\.tsx?\2/g,
    (_match, prefix: string, quote: string, modulePath: string) => `${prefix}${quote}${modulePath}${quote}`,
  );
}

/** The provenance header §18.2 asks for: "stamp `// @gpu-components/timeline@0.4.2` in a header". */
export function stampHeader(source: string, item: string, version: string): string {
  return (
    `// @gpu-components/${item}@${version}\n` +
    `// This file was copied into your repository and is yours to edit.\n` +
    `// \`npx gpu-components diff ${item}\` shows what has changed upstream since.\n` +
    source
  );
}

/** Everything `add` does to a file between reading it and writing it. */
export function transform(source: string, item: string, version: string): string {
  return stampHeader(rewriteImportExtensions(source), item, version);
}

/** Strips a stamped header, so `diff` compares code against code. */
export function stripHeader(source: string): string {
  const lines = source.split("\n");
  let i = 0;
  while (i < lines.length && lines[i]!.startsWith("// @gpu-components/")) i++;
  while (i < lines.length && lines[i]!.startsWith("// ")) i++;
  return lines.slice(i).join("\n");
}
