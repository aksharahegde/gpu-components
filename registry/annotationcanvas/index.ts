export { ingestField, MAX_FIELD_DIM, VALUE_STRIDE } from "./ingest.ts";
export type { FieldData, IngestFieldInput } from "./ingest.ts";
export { areaEllipse, areaPolygon, areaRect, lengthOf } from "./measure.ts";
export type { Point2D } from "./measure.ts";
export {
  createScene,
  distanceToSegment,
  pointInEllipse,
  pointInPolygon,
  pointInRect,
} from "./scene.ts";
export type { Annotation, AnnotationKind, Scene } from "./scene.ts";
export { AnnotationCanvasComponent } from "./AnnotationCanvasComponent.ts";
export type { AnnotationCanvasProps, AnnotationColormap } from "./AnnotationCanvasComponent.ts";
export {
  createAnnotationId,
  createToolController,
  DRAFT_ANNOTATION_ID,
  MAX_POLYGON_POINTS,
  moveAnnotation,
  rectFromDrag,
  simplifyPoints,
} from "./tools.ts";
export type { ImagePoint, ToolController, ToolName } from "./tools.ts";
export { GPUAnnotationCanvas } from "./GPUAnnotationCanvas.tsx";
export type { GPUAnnotationCanvasProps } from "./GPUAnnotationCanvas.tsx";
