import { prepareShader } from "@vgpu/wgsl/prepare";
import type { ShaderSource } from "vgpu";

const cache = new Map<string, ShaderSource>();

/**
 * Turns raw WGSL text into the prepared `ShaderSource` that vgpu >= 0.5 requires (`effect`,
 * `draw` and `compute` no longer accept strings). Pass an already-prepared `ShaderSource`
 * through untouched. Results for string input are memoised per source text.
 */
export function shaderSource(source: string | ShaderSource): ShaderSource {
  if (typeof source !== "string") return source;
  let prepared = cache.get(source);
  if (!prepared) {
    prepared = prepareShader(source);
    cache.set(source, prepared);
  }
  return prepared;
}
