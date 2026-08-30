// A minimal Node ESM loader hook that transforms `.tsx` source (JSX + TS) via esbuild before
// handing it to Node. `.ts` files are untouched — they keep going through Node's own
// `--experimental-strip-types`, which is a pure type-erasure pass and cannot handle JSX syntax at
// all (JSX isn't a type annotation; it needs a real code transform). `esbuild` is already present
// transitively (via `vite`, a devDependency of apps/site and apps/bench) — not a new dependency.
//
// Registered via registry/timeline/test/register.mjs; see the root `test:registry` script.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

export async function load(url, context, nextLoad) {
  if (url.endsWith(".tsx")) {
    const source = await readFile(fileURLToPath(url), "utf8");
    const { code } = await transform(source, {
      loader: "tsx",
      format: "esm",
      target: "esnext",
      jsx: "automatic", // matches this codebase's tsconfig `jsx: "react-jsx"` — no `import React` needed
      sourcefile: fileURLToPath(url),
    });
    return { format: "module", source: code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
