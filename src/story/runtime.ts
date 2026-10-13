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
  ...quantities,
  TensorData,
  tensorOriginId,
  SceneShell,
  mountScene,
  IllustratedStory,
  story,
};
