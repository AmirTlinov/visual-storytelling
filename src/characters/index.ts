export { CharacterStory } from './story.js';
export { CharacterStage } from './stage.js';
export { chibi } from './packs/chibi.js';
export { laboratory, conservatory, workshop } from './sets.js';
export { bulb, seedling, spark, workbench } from './props.js';
export type {
  CharacterPack,
  CharacterStageOptions,
  CharacterStoryOptions,
  StageSet,
  Actor,
  Beat,
  Prop,
  PropArt,
  PropChange,
  Point,
  Place,
} from './types.js';

export { readingRoom, teachingRoom, street, courtyard, prepareSet } from './staging/sets.js';
export { project, ground } from './staging/space.js';
export type {
  StageAction,
  Staging,
  GroundPoint,
  Projection,
  Furniture,
  Shot,
  BipedRig,
} from './staging/types.js';

export { stagingCatalog } from './staging/catalog.js';
export { arrange, destination } from './staging/layout.js';
export type { SetLayout } from './staging/layout.js';
export type { Destination, RelativePlace, Facing } from './staging/types.js';
export { routines } from './routines.js';
export type {
  RoomOptions,
  StreetOptions,
  CourtyardOptions,
  StagePerspective,
} from './staging/sets.js';

export { portable } from './staging/portable.js';

export type { CharacterSurface } from './surfaces.js';
