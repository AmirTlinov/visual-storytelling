import { divisionModel } from './division-model.js';
import { circuitModel } from './circuit-model.js';
import type { StoryModules } from '../story/model.js';

/** Prepared subjects register their ordinary model owner at this assembly boundary. */
export const storyModels: StoryModules = { division: divisionModel, circuit: circuitModel };

import { divisionStory } from './division-story.js';
import type { StoryDocument } from '../story/document-schema.js';
export const storyRecipes: Readonly<Record<string, (input: unknown) => StoryDocument>> = {
  division: (input) => divisionStory(input as Parameters<typeof divisionStory>[0]),
};
