import {
  sceneAccess,
  type SceneCommand,
  type SceneInspection,
  type SceneAccessOwner,
  type SceneControlOptions,
} from './scene-access.js';
import type { Theme } from './ink/palette.js';
import type { CueReview } from './story/cues.js';
import { inspectPresentation, type ScenePresentation } from './scene-frame.js';
import { captureScene, restoreScene, type SceneCheckpoint } from './scene-checkpoint.js';
import { sceneObjects } from './scene-objects.js';
export type { ObjectMeaning } from './scene-objects.js';

declare global {
  interface HTMLElement {
    scene?: SceneHandle;
  }
  interface SVGSVGElement {
    scene?: SceneHandle;
  }
}

/** Capabilities supplied by the actual subject, player and drawing owners. */
export interface SceneRuntime {
  readonly duration?: number;
  readonly currentTime?: number;
  readonly playing?: boolean;
  readonly muted?: boolean;
  readonly rate?: number;
  readonly selected?: readonly string[];
  objects?(): ReturnType<ReturnType<typeof sceneObjects>['objects']>;
  select?(ids: readonly string[]): void;
  readonly experimentHistory?: { undo: boolean; redo: boolean };
  undoExperiment?(): Promise<void>;
  redoExperiment?(): Promise<void>;
  mute?(value: boolean): void;
  setRate?(value: number): void;
  play?(): void | Promise<void>;
  seek?(time: number): void;
  pause?(): void;
  setReduced?(value: boolean): void;
  snapshot?(): unknown;
  review?(): CueReview;
  presentation?(): ScenePresentation;
  focus?(ids: readonly string[]): void;
  dispose(): void;
  setTheme?(value: Theme): void | Promise<void>;
  svg?(): SVGSVGElement;
  exportSVG?(): Promise<string>;
  checkpoints?: readonly number[];
  audioURL?: string;
}

/** One inspectable boundary for stories, editable models and native SVG. */
export interface SceneHandle extends SceneRuntime {
  capture(): SceneCheckpoint;
  restore(state: SceneCheckpoint): Promise<SceneInspection>;
  inspect(options?: { presentation?: boolean }): SceneInspection;
  control(
    commands: readonly SceneCommand[],
    options?: SceneControlOptions,
  ): Promise<SceneInspection>;
  find(query: string): CueReview['cues'];
  snapshot(): unknown;
  review(): CueReview;
  presentation(): ScenePresentation;
}

/** Register existing owners without introducing a clock or a second model. */
export function mountScene<T extends SceneRuntime>(
  root: HTMLElement | SVGSVGElement,
  runtime: T,
  owner: Omit<SceneAccessOwner, 'assertLive'> = {},
): T & SceneHandle {
  if (root.scene) throw new Error('Dispose the mounted scene before replacing it');
  let disposed = false;
  const subjects = sceneObjects(root);
  const assertLive = () => {
    if (disposed || root.scene !== handle) throw new Error('Scene has been disposed or replaced');
  };
  const handle = {
    snapshot: () => null,
    review: (): CueReview => ({ duration: handle.duration ?? 0, cues: [], segments: [] }),
    presentation: () => inspectPresentation(root),
    objects: subjects.objects,
    select: subjects.select,
    get selected() {
      return subjects.selected;
    },
  } as unknown as T & SceneHandle;
  // Forward both own and prototype capabilities to their original receiver. Copying
  // descriptors freezes data fields and breaks class getters/private fields.
  const keys = new Set<PropertyKey>();
  for (
    let source = runtime;
    source && source !== Object.prototype;
    source = Object.getPrototypeOf(source)
  )
    for (const key of Reflect.ownKeys(source))
      if (key !== 'constructor' && key !== 'dispose') keys.add(key);
  for (const key of keys) {
    let method: Function | undefined, bound: ((...args: unknown[]) => unknown) | undefined;
    Object.defineProperty(handle, key, {
      configurable: true,
      enumerable: true,
      get() {
        const value = Reflect.get(runtime, key, runtime);
        if (typeof value !== 'function') return value;
        if (method !== value) {
          method = value;
          bound = (...args: unknown[]) => {
            assertLive();
            return Reflect.apply(value, runtime, args);
          };
        }
        return bound;
      },
      set(next: unknown) {
        assertLive();
        if (!Reflect.set(runtime, key, next, runtime))
          throw new Error(`Scene property ${String(key)} is read-only`);
      },
    });
  }
  handle.dispose = () => {
    if (disposed || root.scene !== handle) return;
    disposed = true;
    subjects.dispose();
    try {
      runtime.dispose();
    } finally {
      if (root.scene === handle) delete root.scene;
    }
  };
  const access = Object.defineProperties(
    {},
    Object.getOwnPropertyDescriptors(owner),
  ) as SceneAccessOwner;
  access.assertLive = assertLive;
  access.playing ??= () => runtime.playing ?? false;
  Object.assign(handle, sceneAccess(handle, access));
  handle.capture = () => captureScene(handle, access.view?.());
  handle.restore = (state) => restoreScene(handle, state, access.view?.());
  root.scene = handle;
  return handle;
}
