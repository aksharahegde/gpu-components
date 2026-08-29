/** The global uniform block shared across every mounted component, written once per tick by the
 * `FrameScheduler` (PLAN.md §10.1, §11.1). Component-specific uniforms are the component's own. */
export interface Globals extends Record<string, unknown> {
  readonly time: number;
  readonly deltaTime: number;
  readonly dpr: number;
}
