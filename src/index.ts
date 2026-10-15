export * from './ink/index.js';
export * from './story/index.js';
export * from './controls/index.js';
export * from './recipes/index.js';
export * from './export/index.js';
export {
  placeLabels,
  type LabelBox,
  type LabelLimits,
  type LabelSegment,
  type LabelPlacement,
  type LabelPlacementOptions,
} from './layout/labels.js';
export * from './layout/svg.js';
export * from './scene.js';
export { describeObject, type ObjectMeaning } from './scene-objects.js';
export type { SourceSpan } from './scene-source.js';
export * from './viewport/svg.js';
export { default as rough } from 'roughjs';
export { gsap } from 'gsap';
export * from './explorer/index.js';
export * from './host/widget-state.js';
export {
  divisionState,
  divisionProgress,
  divisionItemId,
  divisionGroupId,
} from './math/division.js';
export type { DivisionState } from './math/division.js';

export { releaseResources } from './lifecycle.js';
export { TensorData, tensorOriginId } from './math/tensor.js';
export type { TensorDataOptions, TensorOrigin } from './math/tensor.js';
export type { MathValue } from './math/value.js';
export { MathMorph } from './morph/math.js';
export { mathPlan } from './morph/plan.js';
export type {
  Value,
  MathState,
  Input,
  Coordinate,
  Domain,
  MarkStyle,
  CurveStyle,
  MaterialStyle,
  ModelStep,
  ModelPanel,
  ModelObject,
  Explanation,
} from './morph/model/index.js';
export type {
  ConstructionPlan,
  ConstructionFrame,
  DiagramPoint,
  DiagramBounds,
  DiagramCamera,
  Matrix2,
  ScalarFunction,
} from './morph/construction/types.js';
export type {
  FormulaBody,
  FormulaInput,
  FormulaOptions,
  FormulaOperation,
} from './morph/formula/types.js';
export type {
  Arithmetic,
  CellOperation,
  MathStep,
  MathOperation,
  VectorInput,
  MathMorphFrame,
  MathMorphPlan,
  MathPart,
  MathOrigin,
  MathNote,
} from './morph/types.js';
export type { MorphTime, MorphCues } from './morph/timing.js';
export { MathMorph2D } from './morph/svg.js';
export { Morph, morphPlan } from './morph/objects.js';
export { Morph2D } from './morph/object-2d.js';
export { InkMorph } from './morph/ink-operation.js';
export type { InkOperation } from './morph/ink-operation.js';
export type {
  MorphObject,
  MorphBody,
  MorphFrame,
  MorphOperation,
  MorphPlan,
} from './morph/objects.js';

export type { DeformationOptions } from './morph/construction/deformation.js';

export type {
  SceneCommand,
  SceneInspection,
  SceneSearchResult,
  SceneRendering,
  SceneRenderMoment,
} from './scene-access.js';

export * from './math/rational.js';
export * from './math/quantity-parts.js';

export * from './math/lever.js';

export {
  normalizeLogits,
  softmax,
  probabilityRows,
  rankProbabilities,
} from './math/probability.js';
export type { ProbabilityTrace, ProbabilityRow } from './math/probability.js';
export { sampleBernoulli, wilsonInterval, binomialPrefix } from './math/binomial.js';

export { borrowSceneView } from './scene/view-access.js';
