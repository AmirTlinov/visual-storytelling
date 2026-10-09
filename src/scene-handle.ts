import {
  sceneAccess,
  type SceneCommand,
  type SceneInspection,
  type SceneAccessOwner,
  type SceneControlOptions,
  type SceneSearchResult,
  type SceneRendering,
} from './scene-access.js';
import type { Theme } from './ink/palette.js';
import type { CueReview } from './story/cues.js';
import { inspectPresentation, type ScenePresentation } from './scene-frame.js';
import {
  captureScene,
  restoreScene,
  type SceneCheckpoint,
  type SceneCaptureOptions,
  type SceneSubject,
  type SceneView,
} from './scene-checkpoint.js';
import { sceneObjects } from './scene-objects.js';
import { connectSceneHost, type SceneHost } from './host/adapter.js';
import type { SceneRestoreNotice } from './scene-checkpoint.js';
export type { ObjectMeaning } from './scene-objects.js';
export type { SceneHost } from './host/adapter.js';

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
  /** Opaque owner identity of the full accepted condition; never a visible parameter projection. */
  readonly condition?: object;
  readonly subject?: SceneSubject;
  readonly camera?: SceneView;
  readonly rendering?: SceneRendering;
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
  mute?(value: boolean): void | Promise<void>;
  setRate?(value: number): void;
  play?(): void | Promise<void>;
  seek?(time: number): void;
  /** Resolve when the latest requested frame is prepared and rendered. */
  ready?(): Promise<void>;
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
  /** Extend capabilities through their owner, retaining live getters and method receivers. */
  extend<T extends object>(extension: T & Partial<SceneRuntime>): this & T;
  connectHost(host: SceneHost): () => void;
  readonly restoreNotices?: readonly SceneRestoreNotice[];
  capture(options?: SceneCaptureOptions): SceneCheckpoint;
  restore(state: SceneCheckpoint): Promise<SceneInspection>;
  inspect(options?: { presentation?: boolean }): SceneInspection;
  control(
    commands: readonly SceneCommand[],
    options?: SceneControlOptions,
  ): Promise<SceneInspection>;
  find(query: string): SceneSearchResult[];
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
  let disconnectHost: (() => void) | undefined;
  let restoreNotices: readonly SceneRestoreNotice[] = [];
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
  function extend<T extends object>(runtime: T, initial = false): T & SceneHandle {
    assertLive();
    const keys = new Set<PropertyKey>();
    for (
      let source = runtime;
      source && source !== Object.prototype;
      source = Object.getPrototypeOf(source)
    )
      for (const key of Reflect.ownKeys(source))
        if (key !== 'constructor' && (!initial || key !== 'dispose')) keys.add(key);
    const reserved = [
      'dispose',
      'extend',
      'connectHost',
      'capture',
      'restore',
      'inspect',
      'control',
      'find',
      'restoreNotices',
    ];
    if ([...keys].some((key) => reserved.includes(String(key))))
      throw new Error('Scene lifecycle and access methods cannot be replaced by an extension');
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
              if (key === 'snapshot' && handle.rendering && !handle.rendering.presented)
                return undefined;
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
    return handle as unknown as T & SceneHandle;
  }
  // Initial runtime owns disposal; extension cannot replace the boundary itself.
  root.scene = handle;
  extend(runtime, true);
  handle.extend = (extension) => extend(extension) as typeof handle & typeof extension;
  handle.connectHost = (host) => {
    assertLive();
    disconnectHost?.();
    disconnectHost = connectSceneHost(host);
    return disconnectHost;
  };
  Object.defineProperty(handle, 'restoreNotices', { get: () => restoreNotices });
  handle.dispose = () => {
    if (disposed || root.scene !== handle) return;
    disposed = true;
    disconnectHost?.();
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
  access.view ??= () => handle.camera;
  Object.assign(handle, sceneAccess(handle, access));
  handle.capture = (options) => captureScene(handle, access.view?.(), options);
  let restoration = 0;
  handle.restore = async (state) => {
    const request = ++restoration;
    const restoring = Object.defineProperties(
      {},
      Object.getOwnPropertyDescriptors(access),
    ) as SceneAccessOwner;
    restoring.assertLive = () => {
      assertLive();
      if (request !== restoration)
        throw Object.assign(new Error('Scene restoration was superseded by a newer restore.'), {
          code: 'scene_restore_superseded',
        });
    };
    const restored = await restoreScene(handle, state, access.view?.(), restoring);
    restoring.assertLive();
    restoreNotices = restored.restoreNotices ?? [];
    if (restoreNotices.length)
      root.dispatchEvent(
        new CustomEvent('scene-restored', { bubbles: true, detail: restoreNotices }),
      );
    return restored;
  };
  root.scene = handle;
  return handle;
}
