/**
 * The hero scene's camera pose, shared between `Hero3DComponent` (which actually builds the
 * `perspectiveCamera()`) and `data.ts` (which needs the same numbers to size each depth layer's
 * content so it actually fills a sane fraction of the view frustum at its own depth — the bug this
 * file exists to prevent: content authored in a fixed coordinate range with no relationship to the
 * camera's distance-dependent frustum size either renders as a tiny cluster near the vanishing
 * point (too far back for its size) or blows out past the frame (too close), and doing that
 * unconstrained per layer produced exactly the former the first time this scene was built.
 */
export const CAMERA_FOV_Y_DEG = 46;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 30;
export const CAMERA_POSITION_Z = 3.4;

/** Design-time aspect ratio used only to size seeded content plausibly (`data.ts`'s
 * `frustumHalfExtentsAt`) — the real draw-time camera aspect tracks the actual canvas
 * (`Hero3DComponent.syncCamera`); this is an authoring approximation, not a runtime constraint. */
export const DESIGN_ASPECT = 2.85;

/** Half-height and half-width of the camera's view frustum at world-space depth `z` (camera looks
 * down `-Z` from `[0, 0, CAMERA_POSITION_Z]`), at `DESIGN_ASPECT`. */
export function frustumHalfExtentsAt(z: number): { readonly halfW: number; readonly halfH: number } {
  const distance = CAMERA_POSITION_Z - z;
  const halfH = distance * Math.tan((CAMERA_FOV_Y_DEG * Math.PI) / 180 / 2);
  return { halfW: halfH * DESIGN_ASPECT, halfH };
}
