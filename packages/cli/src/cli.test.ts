import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { add, diff, doctorChecks, list, missingDependencies, targetDir, type Io } from "./cli.ts";
import { isValidItemName, rewriteImportExtensions, stampHeader, stripHeader, sha256, type Registry } from "./registry.ts";

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(readFileSync(path.join(cliRoot, "registry.json"), "utf8")) as Registry;
const componentsRoot = path.join(cliRoot, "components");

function scratch(overrides: Partial<Io> = {}): {
  io: Io;
  out: string[];
  err: string[];
  cwd: string;
  asked: string[];
} {
  const cwd = mkdtempSync(path.join(tmpdir(), "gpu-components-"));
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  return {
    cwd,
    out,
    err,
    asked,
    io: {
      cwd,
      assumeYes: true,
      log: (m) => {
        out.push(m);
      },
      error: (m) => {
        err.push(m);
      },
      confirm: (question) => {
        asked.push(question);
        return true;
      },
      ...overrides,
    },
  };
}

describe("import extension rewriting — the transform that makes copied source compile", () => {
  it("strips .ts and .tsx from relative specifiers only", () => {
    const source = [
      `import { a } from "./ingest.ts";`,
      `import { b } from "../shared/util.tsx";`,
      `import { c } from "@gpuc/core";`,
      `import { d } from "vgpu";`,
      `export { e } from "./sub/thing.ts";`,
    ].join("\n");

    const out = rewriteImportExtensions(source);
    assert.match(out, /from "\.\/ingest"/);
    assert.match(out, /from "\.\.\/shared\/util"/);
    assert.match(out, /from "\.\/sub\/thing"/);
    // Package specifiers must survive untouched, including ones that merely contain a dot.
    assert.match(out, /from "@gpuc\/core"/);
    assert.match(out, /from "vgpu"/);
  });

  it("leaves a package name that ends in .ts alone", () => {
    const source = `import x from "some.ts-package";`;
    assert.equal(rewriteImportExtensions(source), source);
  });

  it("handles dynamic imports", () => {
    assert.match(rewriteImportExtensions(`await import("./lazy.ts")`), /import\("\.\/lazy"\)/);
  });
});

describe("provenance header", () => {
  it("stamps the component and version, and round-trips through stripHeader", () => {
    const body = `export const x = 1;\n`;
    const stamped = stampHeader(body, "timeline", "0.4.2");
    assert.match(stamped, /^\/\/ @gpuc\/timeline@0\.4\.2\n/);
    assert.equal(stripHeader(stamped), body);
  });

  it("leaves an unstamped file unchanged", () => {
    const body = `export const x = 1;\n`;
    assert.equal(stripHeader(body), body);
  });
});

describe("registry integrity", () => {
  it("every bundled file matches the hash recorded for it", () => {
    // §24.3: "every registry item ships a SHA-256; the CLI verifies before writing". If this test
    // fails, the bundled components and registry.json have drifted apart.
    for (const item of registry.items) {
      for (const file of item.files) {
        const source = readFileSync(path.join(componentsRoot, item.name, file.path), "utf8");
        assert.equal(sha256(source), file.hash, `${item.name}/${file.path}`);
      }
    }
  });

  it("records the packages each component needs", () => {
    for (const item of registry.items) {
      assert.ok(item.dependencies.includes("@gpuc/core"), `${item.name} should need core`);
      assert.ok(item.files.length > 0);
    }
  });
});

describe("add", () => {
  it("writes every file, rewritten and stamped", () => {
    const { io, cwd } = scratch();
    assert.equal(add(registry, componentsRoot, "scatter", io), 0);

    const dir = targetDir(io, "scatter");
    const written = readdirSync(dir).sort();
    const expected = registry.items.find((i) => i.name === "scatter")!.files.map((f) => f.path).sort();
    assert.deepEqual(written, expected);

    const index = readFileSync(path.join(dir, "index.ts"), "utf8");
    assert.match(index, /^\/\/ @gpuc\/scatter@/);
    assert.doesNotMatch(index, /from "\.\/[^"]*\.tsx?"/, "no .ts extensions may survive into the copy");
    assert.ok(path.relative(cwd, dir).startsWith("components"), "defaults under components/gpu");
  });

  it("refuses an unknown component instead of writing anything", () => {
    const { io, err } = scratch();
    assert.equal(add(registry, componentsRoot, "nope", io), 1);
    assert.match(err[0]!, /unknown component/);
  });

  it("refuses to overwrite an existing copy without --force", () => {
    const { io, err } = scratch();
    assert.equal(add(registry, componentsRoot, "scatter", io), 0);
    assert.equal(add(registry, componentsRoot, "scatter", io), 1);
    assert.match(err[0]!, /already exists/);
    assert.match(err[0]!, /--force/);
  });

  it("overwrites with --force", () => {
    const { io } = scratch();
    add(registry, componentsRoot, "scatter", io);
    writeFileSync(path.join(targetDir(io, "scatter"), "index.ts"), "// mine\n");
    assert.equal(add(registry, componentsRoot, "scatter", io, { force: true }), 0);
    assert.match(readFileSync(path.join(targetDir(io, "scatter"), "index.ts"), "utf8"), /@gpuc\/scatter@/);
  });

  it("honours --path", () => {
    const { io, cwd } = scratch();
    assert.equal(add(registry, componentsRoot, "grid", io, { path: "src/vendor" }), 0);
    assert.ok(readdirSync(path.join(cwd, "src/vendor/grid")).length > 0);
  });
});

describe("missing dependencies", () => {
  it("lists what the project has not declared", () => {
    const { cwd } = scratch();
    writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify({ dependencies: { react: "^18.0.0", vgpu: "^0.3.1" } }),
    );
    const item = registry.items.find((i) => i.name === "heatmap")!;
    assert.deepEqual(missingDependencies(cwd, item), ["@gpuc/core", "@gpuc/react"]);
  });

  it("treats a project with no package.json as missing everything", () => {
    const { cwd } = scratch();
    const item = registry.items.find((i) => i.name === "heatmap")!;
    assert.deepEqual(missingDependencies(cwd, item), [...item.dependencies]);
  });

  it("treats a malformed package.json as missing everything, instead of throwing", () => {
    const { cwd } = scratch();
    writeFileSync(path.join(cwd, "package.json"), "{ not valid json");
    const item = registry.items.find((i) => i.name === "heatmap")!;
    assert.doesNotThrow(() => missingDependencies(cwd, item));
    assert.deepEqual(missingDependencies(cwd, item), [...item.dependencies]);
  });
});

describe("diff", () => {
  it("reports an untouched copy as identical", () => {
    const { io, out } = scratch();
    add(registry, componentsRoot, "scatter", io);
    out.length = 0;
    assert.equal(diff(registry, componentsRoot, "scatter", io), 0);
    assert.ok(out.some((line) => line.includes("identical")), out.join("\n"));
  });

  it("reports a file the user edited", () => {
    const { io, out } = scratch();
    add(registry, componentsRoot, "scatter", io);
    const file = path.join(targetDir(io, "scatter"), "ingest.ts");
    writeFileSync(file, `${readFileSync(file, "utf8")}\n// my change\n`);

    out.length = 0;
    assert.equal(diff(registry, componentsRoot, "scatter", io), 0);
    assert.ok(out.some((l) => l.includes("differs") && l.includes("ingest.ts")), out.join("\n"));
  });

  it("ignores a version-only header change, so a bump is not reported as drift", () => {
    const { io, out } = scratch();
    add(registry, componentsRoot, "scatter", io);
    const file = path.join(targetDir(io, "scatter"), "ingest.ts");
    const body = stripHeader(readFileSync(file, "utf8"));
    writeFileSync(file, stampHeader(body, "scatter", "0.0.1-old"));

    out.length = 0;
    diff(registry, componentsRoot, "scatter", io);
    assert.ok(out.some((line) => line.includes("identical")), out.join("\n"));
  });

  it("reports a deleted file and a file the user added", () => {
    const { io, out } = scratch();
    add(registry, componentsRoot, "scatter", io);
    const dir = targetDir(io, "scatter");
    writeFileSync(path.join(dir, "mine.ts"), "export const mine = 1;\n");
    out.length = 0;
    diff(registry, componentsRoot, "scatter", io);
    assert.ok(out.some((l) => l.includes("mine.ts")), "a file the user added should be listed");
  });

  it("refuses to diff a component that was never added", () => {
    const { io, err } = scratch();
    assert.equal(diff(registry, componentsRoot, "timeline", io), 1);
    assert.match(err[0]!, /does not exist/);
  });
});

describe("doctor", () => {
  it("flags every missing dependency in an empty project", () => {
    const { cwd } = scratch();
    const checks = doctorChecks(cwd, registry);
    const failed = checks.filter((c) => !c.ok).map((c) => c.name);
    assert.ok(failed.includes("project"), "no package.json should fail");
    assert.ok(failed.includes("@gpuc/core"));
    assert.ok(failed.includes("vgpu"));
  });

  it("passes a project that declares everything", () => {
    const { cwd } = scratch();
    writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify({
        dependencies: {
          "@gpuc/core": "^0.1.0",
          "@gpuc/react": "^0.1.0",
          vgpu: "^0.3.1",
          react: "^18.3.1",
        },
      }),
    );
    assert.deepEqual(doctorChecks(cwd, registry).filter((c) => !c.ok), []);
  });

  it("reports a malformed package.json as a failed check, instead of throwing", () => {
    const { cwd } = scratch();
    writeFileSync(path.join(cwd, "package.json"), "{ not valid json");
    let checks: ReturnType<typeof doctorChecks> = [];
    assert.doesNotThrow(() => {
      checks = doctorChecks(cwd, registry);
    });
    const project = checks.find((c) => c.name === "project")!;
    assert.equal(project.ok, false);
    assert.match(project.detail, /not valid JSON/);
  });

  it("reports the tsconfig situation rather than demanding a change", () => {
    const { cwd } = scratch();
    writeFileSync(path.join(cwd, "package.json"), "{}");
    writeFileSync(path.join(cwd, "tsconfig.json"), `{ "compilerOptions": {} }`);
    const tsconfig = doctorChecks(cwd, registry).find((c) => c.name === "tsconfig")!;
    assert.equal(tsconfig.ok, true, "a standard tsconfig is not an error — `add` handles it");
    assert.match(tsconfig.detail, /rewrites/);
  });
});

describe("list", () => {
  it("names every component and how to add it", () => {
    const { io, out } = scratch();
    assert.equal(list(registry, io), 0);
    const text = out.join("\n");
    for (const item of registry.items) assert.ok(text.includes(item.name), item.name);
    assert.match(text, /npx @gpuc\/cli add/);
  });
});

describe("confirmation before writing (§24.3)", () => {
  it("asks before writing when not running with --yes", () => {
    const { io, cwd, asked } = scratch({ assumeYes: false });
    assert.equal(add(registry, componentsRoot, "scatter", io), 0);
    assert.equal(asked.length, 1, "should have asked exactly once");
    assert.match(asked[0]!, /Write \d+ files/);
    assert.ok(readdirSync(path.join(cwd, "components/gpu/scatter")).length > 0);
  });

  it("writes nothing when the user declines", () => {
    const { io, cwd, out } = scratch({ assumeYes: false, confirm: () => false });
    assert.equal(add(registry, componentsRoot, "scatter", io), 1);
    assert.equal(existsSync(path.join(cwd, "components/gpu/scatter")), false, "no directory created");
    assert.ok(out.some((l) => l.includes("Cancelled")));
  });

  it("does not ask when assumeYes is set", () => {
    const { io, asked } = scratch({ assumeYes: true });
    add(registry, componentsRoot, "scatter", io);
    assert.deepEqual(asked, []);
  });

  it("still lists the files before asking, so there is something to read", () => {
    const { io, out } = scratch({ assumeYes: false });
    add(registry, componentsRoot, "scatter", io);
    const printedBeforePrompt = out.some((l) => l.includes("index.ts"));
    assert.ok(printedBeforePrompt, "the file list is the thing the user is confirming");
  });
});

describe("registry path containment (§24.1 supply chain)", () => {
  /** A registry whose entry escapes its directory — what a tampered package would look like. */
  function tamperedRegistry(escapePath: string): Registry {
    const scatter = registry.items.find((i) => i.name === "scatter")!;
    return {
      ...registry,
      items: [{ ...scatter, files: [{ path: escapePath, type: "registry:component", hash: "0".repeat(64) }] }],
    };
  }

  it("refuses a traversing path instead of writing outside the target", () => {
    const { io } = scratch();
    assert.throws(
      () => add(tamperedRegistry("../../../evil.ts"), componentsRoot, "scatter", io),
      /resolves outside its component directory/,
    );
  });

  it("refuses an absolute path", () => {
    const { io } = scratch();
    assert.throws(
      () => add(tamperedRegistry("/tmp/evil.ts"), componentsRoot, "scatter", io),
      /resolves outside its component directory/,
    );
  });

  it("still allows an ordinary nested path", () => {
    // Containment must not ban legitimate subdirectories — a component may ship shaders/foo.wgsl.
    const { io } = scratch();
    assert.throws(
      () => add(tamperedRegistry("shaders/foo.ts"), componentsRoot, "scatter", io),
      /registry file missing from the package/,
      "should fail on the missing file, not on containment",
    );
  });
});

describe("item name validation (§24.1 supply chain — the name itself is attacker-controlled data)", () => {
  /** A registry whose item's own `name` field is what a tampered package would ship. */
  function withTamperedName(name: string): Registry {
    const scatter = registry.items.find((i) => i.name === "scatter")!;
    return { ...registry, items: [{ ...scatter, name }] };
  }

  it("accepts ordinary slugs", () => {
    assert.ok(isValidItemName("scatter"));
    assert.ok(isValidItemName("dep-graph"));
    assert.ok(isValidItemName("a1"));
  });

  it("rejects a traversal sequence", () => {
    assert.equal(isValidItemName("../../../../tmp/x"), false);
  });

  it("rejects an absolute path", () => {
    assert.equal(isValidItemName("/tmp/evil"), false);
  });

  it("rejects uppercase and other non-slug characters", () => {
    assert.equal(isValidItemName("Scatter"), false);
    assert.equal(isValidItemName("scatter_bad"), false);
    assert.equal(isValidItemName(""), false);
  });

  it("refuses to add a component whose registry name is a traversal sequence, and writes nothing outside the target", () => {
    const evilName = "../../../../tmp/gpu-components-escape";
    const { io, cwd } = scratch();
    assert.throws(
      () => add(withTamperedName(evilName), componentsRoot, evilName, io),
      /not a valid component name/,
    );
    // Nothing should have been written anywhere, inside or outside the project.
    assert.equal(existsSync(path.join(cwd, "components")), false);
    assert.equal(existsSync(path.resolve(cwd, evilName)), false);
  });

  it("refuses to diff a component whose registry name is a traversal sequence", () => {
    const evilName = "../../../../tmp/gpu-components-escape";
    const { io } = scratch();
    assert.throws(
      () => diff(withTamperedName(evilName), componentsRoot, evilName, io),
      /not a valid component name/,
    );
  });
});
