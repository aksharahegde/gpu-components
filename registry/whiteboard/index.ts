export { ingestWhiteboard, MAX_COORDINATE, RECOMMENDED_MAX_SHAPES } from "./ingest.ts";
export type { Point2D, WhiteboardData, WhiteboardShape, WhiteboardShapeKind } from "./ingest.ts";
export { boundsIntersect, createScene, DEFAULT_HIT_TOLERANCE, shapeBounds } from "./scene.ts";
export type { Bounds, Scene } from "./scene.ts";
export { WhiteboardComponent } from "./WhiteboardComponent.ts";
export type { WhiteboardProps } from "./WhiteboardComponent.ts";
export {
  createShapeId,
  createToolController,
  DRAFT_SHAPE_ID,
  MAX_POLYGON_POINTS,
  moveShape,
  rectFromDrag,
  simplifyPoints,
} from "./tools.ts";
export type { DomainPoint, ToolController, ToolName } from "./tools.ts";
export { GPUWhiteboard } from "./GPUWhiteboard.tsx";
export type { GPUWhiteboardProps, WhiteboardTool } from "./GPUWhiteboard.tsx";
