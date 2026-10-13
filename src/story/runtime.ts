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
import { TensorData, tensorOriginId } from '../math/tensor.js';

/** Prepared 2D author modules import these existing owners; they do not bundle a second runtime. */
export const documentRuntime = {
  ...ink,
  ...recipes,
  ...document,
  ...rational,
  ...probability,
  ...binomial,
  ...quantities,
  ...lever,
  compareModelSnapshots,
  TensorData,
  tensorOriginId,
  SceneShell,
  mountScene,
  IllustratedStory,
  story,
};
