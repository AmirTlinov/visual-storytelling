import * as probability from '../math/probability.js';
import * as binomial from '../math/binomial.js';
import * as lever from '../math/lever.js';
import { compareModelSnapshots } from './comparison.js';
import * as ink from '../ink/index.js';
import * as recipes from '../recipes/index.js';
import { SceneShell, mountScene } from '../scene.js';
import { IllustratedStory } from './illustrated.js';
import { story } from './story.js';
import * as document from './document.js';
import * as rational from '../math/rational.js';
import * as quantities from '../math/quantity-parts.js';
import { borrowSceneView } from '../scene/view-access.js';
import { TensorData, tensorOriginId } from '../math/tensor.js';
import { MathMorph } from '../morph/math.js';
import * as viewport from '../viewport/index.js';
import { svgButton } from '../controls/svg.js';
import { placeLabels } from '../layout/labels.js';
import { SvgLayout } from '../layout/svg.js';
import { describeObject } from '../scene-objects.js';

/** Author modules borrow these existing owners instead of bundling another runtime. */
export const documentRuntime = {
  ...ink,
  ...recipes,
  ...document,
  ...rational,
  ...probability,
  ...binomial,
  ...quantities,
  ...lever,
  ...viewport,
  MathMorph,
  svgButton,
  placeLabels,
  SvgLayout: SvgLayout as typeof import('../layout/svg.js').SvgLayout,
  describeObject,
  compareModelSnapshots,
  TensorData,
  borrowSceneView,
  tensorOriginId,
  SceneShell,
  mountScene,
  IllustratedStory,
  story,
};
