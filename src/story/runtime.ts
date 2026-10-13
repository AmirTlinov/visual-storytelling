import * as ink from '../ink/index.js';
import * as recipes from '../recipes/index.js';
import { SceneShell, mountScene } from '../scene.js';
import { IllustratedStory } from './illustrated.js';
import { story } from './story.js';
import * as document from './document.js';

/** Prepared 2D author modules import these existing owners; they do not bundle a second runtime. */
export const documentRuntime = {
  ...ink,
  ...recipes,
  ...document,
  SceneShell,
  mountScene,
  IllustratedStory,
  story,
};
