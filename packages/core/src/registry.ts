interface Entry {
  value: unknown;
  refCount: number;
  dispose?: (value: unknown) => void;
}

/**
 * Content-keyed, ref-counted shared-resource pool (PLAN.md §10.3, §11.1) — colormap textures,
 * glyph atlases, samplers-by-descriptor, and anything else more than one component might want the
 * same instance of. `acquire` creates on first request and reuses on every subsequent one for the
 * same key; the resource is disposed only once its last holder calls `release`.
 */
export class ResourceRegistry {
  private readonly entries = new Map<string, Entry>();

  acquire<T>(key: string, factory: () => T, dispose?: (value: T) => void): T {
    const existing = this.entries.get(key);
    if (existing) {
      existing.refCount += 1;
      return existing.value as T;
    }
    const value = factory();
    this.entries.set(key, {
      value,
      refCount: 1,
      dispose: dispose as ((value: unknown) => void) | undefined,
    });
    return value;
  }

  release(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.refCount -= 1;
    if (entry.refCount > 0) return;
    this.entries.delete(key);
    entry.dispose?.(entry.value);
  }

  /** Diagnostic only — used by leak tests, not by any runtime path. */
  get size(): number {
    return this.entries.size;
  }

  dispose(): void {
    for (const [key, entry] of this.entries) {
      entry.dispose?.(entry.value);
      this.entries.delete(key);
    }
  }
}
