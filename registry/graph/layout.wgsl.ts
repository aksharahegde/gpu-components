export const LAYOUT_WORKGROUP_SIZE = 64;

/**
 * One force-directed layout iteration: repulsion, attraction and integration in a single pass.
 *
 * **This is the project's first iterative compute**, and the reason `GPUGraph` was chosen over
 * cheaper candidates. Every compute pass shipped so far — cull, density bin, reduce, brush — runs
 * once per frame over static data. This one feeds its own output back in, which is what
 * `pingPongStorage` exists for (PLAN.md §19.2's ninth optimisation step, unused until now) and what
 * makes the component set `animating = true` and keep the scheduler running until it converges.
 *
 * One pass rather than three, and no atomics anywhere: each thread owns exactly one node, reads
 * every other node's position for repulsion, walks its own CSR neighbour slice for attraction, and
 * writes its own slot. Nothing is written by more than one thread, so there is nothing to contend
 * over — the same "give each thread sole ownership of its output" shape that let the heatmap's
 * reduction avoid the float-atomics problem.
 *
 * **Repulsion is O(n²), deliberately, with a documented ceiling.** A Barnes-Hut or grid
 * approximation is the standard answer above a few thousand nodes and is genuinely better there;
 * it is also a research rabbit hole (§8.1's words) and approximation makes the layout harder to
 * verify. At the node counts this component targets, the exact loop is fast, simple and testable —
 * and §26 requires every component to publish the point where it stops being the right choice,
 * which for this one is roughly 5,000 nodes.
 */
export const LAYOUT_WGSL = /* wgsl */ `
struct LayoutParams {
  nodeCount: u32,
  // Repulsion strength. Scaled by the square of the ideal edge length so the two forces stay in
  // proportion when the caller tunes one of them.
  repulsion: f32,
  // Spring constant for connected nodes.
  attraction: f32,
  // Velocity retained between iterations. Below 1 the system loses energy and settles.
  damping: f32,
  // Integration step. Fixed rather than frame-time-derived: a layout that changes with frame rate
  // is not reproducible, and reproducibility is what makes this testable (§8.1's determinism note).
  dt: f32,
  // Pulls everything gently toward the origin so disconnected components cannot drift off screen.
  centering: f32,
  // Hard cap on per-iteration displacement, in world units. Without it a dense cluster can produce
  // a force large enough to fling a node to infinity on the first step, and NaN spreads from there.
  maxStep: f32,
  _pad: u32,
}

@group(0) @binding(0) var<uniform> params: LayoutParams;
@group(0) @binding(1) var<storage, read> posIn: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> posOut: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> velocity: array<vec2f>;
@group(0) @binding(4) var<storage, read> adjacencyStarts: array<u32>;
@group(0) @binding(5) var<storage, read> adjacencyItems: array<u32>;

/** Below this separation two nodes are treated as coincident and pushed apart along a fixed axis,
 * because normalize() of a zero vector is NaN — the failure §24.2 calls out. */
const MIN_SEPARATION: f32 = 1e-4;

@compute @workgroup_size(${LAYOUT_WORKGROUP_SIZE})
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.nodeCount) {
    return;
  }

  // Named 'pos', not 'self': self and from are reserved keywords in WGSL. Dawn rejects them;
  // vgpu/mock does not, so this only surfaced in the real-device test.
  let pos = posIn[i];
  var force = vec2f(0.0, 0.0);

  // Repulsion: every other node pushes this one away, falling off with distance.
  for (var j: u32 = 0u; j < params.nodeCount; j = j + 1u) {
    if (j == i) { continue; }
    let delta = pos - posIn[j];
    let distSq = max(dot(delta, delta), MIN_SEPARATION * MIN_SEPARATION);
    let dist = sqrt(distSq);
    // Coincident nodes get a deterministic nudge instead of a NaN direction.
    let dir = select(delta / dist, vec2f(1.0, 0.0), dist <= MIN_SEPARATION);
    force = force + dir * (params.repulsion / distSq);
  }

  // Attraction: only along edges, and only this node's own slice of the CSR adjacency.
  let start = adjacencyStarts[i];
  let end = adjacencyStarts[i + 1u];
  for (var k: u32 = start; k < end; k = k + 1u) {
    let neighbour = adjacencyItems[k];
    let delta = posIn[neighbour] - pos;
    force = force + delta * params.attraction;
  }

  // Centering keeps disconnected subgraphs from wandering out of the viewport forever.
  force = force - pos * params.centering;

  var v = (velocity[i] + force * params.dt) * params.damping;

  // Clamp the step, not the force: a huge force is legitimate when two nodes are on top of each
  // other, but a huge *displacement* is what turns into Infinity and then NaN.
  var step = v * params.dt;
  let stepLength = length(step);
  if (stepLength > params.maxStep) {
    step = step * (params.maxStep / stepLength);
    v = step / params.dt;
  }

  var next = pos + step;
  // Last line of defence: never write a non-finite position back into the simulation, or every
  // subsequent iteration inherits it through the repulsion loop.
  if (!(next.x == next.x) || !(next.y == next.y)) {
    next = pos;
    v = vec2f(0.0, 0.0);
  }

  velocity[i] = v;
  posOut[i] = next;
}
`;
