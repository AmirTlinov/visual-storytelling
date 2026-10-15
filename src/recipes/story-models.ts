import { probabilityModel } from './probability-model.js';
import { samplingModel } from './sampling-model.js';
import { probabilityStory } from './probability-story.js';
import { leverModel } from './lever-model.js';
import { leverStory } from './lever-story.js';
import { leverComparisonModel, routeComparisonModel } from './comparison-owners.js';
import { comparisonStory } from './comparison-story.js';
import { fractionsModel } from './fractions-model.js';
import { fractionsStory } from './fractions-story.js';
import { divisionModel } from './division-model.js';
import { circuitModel } from './circuit-model.js';
import { circuitStory } from './circuit-story.js';
import { instructionalRouteModel } from './dependency-route-model.js';
import type { StoryModules } from '../story/model.js';

/** Prepared subjects register their ordinary model owner at this assembly boundary. */
export const storyModels: StoryModules = {
  probability: probabilityModel,
  sampling: samplingModel,
  division: divisionModel,
  lever: leverModel,
  'lever-comparison': leverComparisonModel,
  'route-comparison': routeComparisonModel,
  fractions: fractionsModel,
  circuit: circuitModel,
  'dependency-route': instructionalRouteModel,
};
export function storyModelOwners(modules: StoryModules = {}) {
  for (const id of Object.keys(modules))
    if (Object.hasOwn(storyModels, id)) throw new Error(`Model module already has an owner: ${id}`);
  return { ...storyModels, ...modules };
}

import { divisionStory } from './division-story.js';
import { dependencyRouteStory } from './dependency-route-story.js';
import type { StoryDocument } from '../story/document-schema.js';
export const storyRecipes: Readonly<Record<string, (input: unknown) => StoryDocument>> = {
  lever: (input) => leverStory(input as Parameters<typeof leverStory>[0]),
  probability: (input) => probabilityStory(input as Parameters<typeof probabilityStory>[0]),
  sampling: (input) => probabilityStory(input as Parameters<typeof probabilityStory>[0]),
  comparison: (input) => comparisonStory(input as Parameters<typeof comparisonStory>[0]),
  division: (input) => divisionStory(input as Parameters<typeof divisionStory>[0]),
  fractions: (input) => fractionsStory(input as Parameters<typeof fractionsStory>[0]),
  circuit: (input) => circuitStory(input as Parameters<typeof circuitStory>[0]),
  'dependency-route': (input) =>
    dependencyRouteStory(input as Parameters<typeof dependencyRouteStory>[0]),
};
