import { story, type Story, type StoryOptions } from './story/story.js';
import { chapterHeading } from './story/chapters.js';
import { captionTrack, type CaptionOptions } from './story/captions.js';
import { sceneFrame, inspectPresentation, type SceneFrameOptions } from './scene-frame.js';
export type { SceneFrameOptions, ScenePresentation } from './scene-frame.js';
import { loadFonts } from './ink/fonts.js';
import { player as statePlayer } from './controls/player.js';
import type { MediaClock } from './story/clock.js';
import type { SceneHandle } from './scene-handle.js';
export type { SceneHandle } from './scene-handle.js';
export interface SceneOptions {
  title: string;
  /** Shared controls can follow a product interface while the subject owns its brand. */
  appearance?: 'sketch' | 'interface';
  paper?: boolean;
  /** Logical composition dimensions for a fixed video frame. Controls remain outside. */
  frame?: SceneFrameOptions;
  /** Hide the shell heading when the subject supplies its own title. */
  heading?: boolean;
  /** Optional visible word-aligned captions; omitted keeps the accessible chapter text. */
  captions?: true | CaptionOptions;
  parameters?: (ControlParameter & { key: string })[];
  onInput?: (values: Record<string, ControlValue>) => void;
  onMode?: (mode: 'story' | 'explore') => void;
  /** View-only exploration leaves narration and model time running. */
  exploration?: 'model' | 'view';
}
export interface SceneMount {
  stage: HTMLDivElement;
  fields: HTMLDivElement;
  actions: HTMLDivElement;
  status: HTMLParagraphElement;
  parameters: Record<string, ControlValue>;
  readonly mode: 'story' | 'explore';
  setMode(mode: 'story' | 'explore'): void;
  setParameters(values: Record<string, ControlValue>): void;
  showParameters(keys?: readonly string[]): void;
  describeParameter(key: string, description: ControlDescription): void;
  attachStory<P, K extends string, S = P>(options: StoryOptions<P, K, S>): Story<P, K, S>;
  attachController<P, K extends string, S>(controller: Story<P, K, S>): SceneHandle;
  /** Register subject-owned observers, animations and subscriptions for removal. */
  onDispose(cleanup: () => void): () => void;
  /** View gestures keep media running; mode buttons and seeking restore the authored shot. */
  attachView(view: { reset(): void; dispose(): void }): void;
  dispose(): void;
}
import {
  SketchControls,
  type ControlDescription,
  type ControlParameter,
  type ControlValue,
} from './controls/fields.js';
/* Shared presentation shell. Subject state and rendering stay in scene.js. */

const node = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number | boolean> = {},
  text?: string,
) => {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
};
function mount(
  root: HTMLElement,
  {
    title,
    paper,
    appearance = 'sketch',
    parameters = [],
    onInput = () => {},
    onMode = () => {},
    exploration = 'model',
    frame,
    heading: showHeading = true,
    captions,
  }: SceneOptions,
): SceneMount {
  const abort = new AbortController(),
    options = { signal: abort.signal };
  const cleanups = new Set<() => void>();
  const values = Object.fromEntries(parameters.map((p) => [p.key, p.value]));
  let inputStory: ((key: string, value: ControlValue) => void) | undefined;
  let view: { reset(): void; dispose(): void } | undefined;
  const heading = node('h1', { class: 've-heading' }, title),
    modes = node('div', { class: 'modes', role: 'group', 'aria-label': 'Режим сцены' });
  const storyButton = node(
    'button',
    { type: 'button', 'data-mode': 'story', 'aria-pressed': 'false', hidden: '' },
    'Рассказ',
  );
  const exploreButton = node(
    'button',
    { type: 'button', 'data-mode': 'explore', 'aria-pressed': 'true' },
    'Исследовать',
  );
  modes.append(storyButton, exploreButton);
  const stage = node('div', { class: 've-stage' }),
    fields = node('div', { class: 've-parameters' });
  fields.style.setProperty('--ve-parameter-columns', String(Math.min(3, parameters.length) || 1));
  modes.hidden = true;
  fields.hidden = !parameters.length;
  const inputs = new Map<string, ReturnType<typeof SketchControls.field>>();
  for (const p of parameters) {
    const control = SketchControls.field(p, (value) => {
      const previous = values[p.key];
      values[p.key] = value;
      try {
        if (inputStory) inputStory(p.key, value);
        else setMode('explore');
      } catch (error) {
        values[p.key] = previous!;
        status.textContent = error instanceof Error ? error.message : String(error);
        return;
      }
      status.textContent = '';
      refresh();
      onInput({ ...values });
    });
    fields.append(control.element);
    inputs.set(p.key, control);
  }
  const actions = node('div', { class: 've-view-actions' }),
    controls = node('div', { 'data-player': '', hidden: '' });
  heading.hidden = !showHeading;
  const caption = node('p', {
      class: captions ? 've-captions' : 'caption sr-only',
      'data-caption': '',
      role: 'status',
    }),
    status = node('p', { class: 've-status', role: 'alert' });
  const composition = frame ? sceneFrame(stage, frame) : undefined;
  if (composition) cleanups.add(composition.dispose);
  root.append(heading, modes, actions, fields, composition?.element ?? stage, controls, status);
  if (captions && composition) stage.append(caption);
  else root.append(caption);
  composition?.resize();
  let transition: ((mode: 'story' | 'explore') => void) | undefined;
  let mode: 'story' | 'explore' = 'explore';
  let media: Pick<MediaClock, 'pause'> | undefined, player: { dispose(): void } | undefined;
  function refresh() {
    for (const [key, control] of inputs)
      if (control.value !== values[key]) control.setValue(values[key]!);
  }
  function setMode(next: 'story' | 'explore') {
    if (next === mode || (next === 'story' && !player)) return;
    mode = next;
    transition?.(next);
    controls.hidden = exploration === 'model' && mode !== 'story';
    caption.hidden = controls.hidden;
    fields.hidden = mode === 'story' || !fields.childElementCount;
    storyButton.setAttribute('aria-pressed', String(mode === 'story'));
    exploreButton.setAttribute('aria-pressed', String(mode === 'explore'));
    root.dataset.sceneMode = mode;
    onMode(mode);
  }
  function selectMode(next: 'story' | 'explore') {
    setMode(next);
    view?.reset();
  }
  storyButton.addEventListener('click', () => selectMode('story'), options);
  exploreButton.addEventListener('click', () => selectMode('explore'), options);
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) media?.pause();
    },
    options,
  );
  refresh();
  root.dataset.sceneMode = mode;
  root.dataset.paper = String(paper ?? appearance === 'sketch');
  root.dataset.appearance = appearance;
  return {
    stage,
    fields,
    actions,
    status,
    parameters: values,
    get mode() {
      return mode;
    },
    setMode,
    setParameters(next: Record<string, ControlValue>) {
      if (Object.entries(next).some(([key, value]) => values[key] !== value)) {
        Object.assign(values, next);
        refresh();
      }
    },
    showParameters(keys?: readonly string[]) {
      let count = 0;
      for (const [key, control] of inputs) {
        control.element.hidden = keys !== undefined && !keys.includes(key);
        if (!control.element.hidden) count++;
      }
      fields.style.setProperty('--ve-parameter-columns', String(Math.min(3, count) || 1));
    },
    describeParameter(key: string, description: ControlDescription) {
      const control = inputs.get(key);
      if (!control) throw new Error(`Unknown scene parameter: ${key}`);
      control.describe(description);
    },
    attachStory<P, K extends string, S = P>(options: StoryOptions<P, K, S>): Story<P, K, S> {
      assertLive();
      const controller = story(options);
      try {
        attachController(controller);
      } catch (error) {
        controller.dispose();
        throw error;
      }
      return controller;
    },
    attachController,
    onDispose(cleanup: () => void) {
      if (abort.signal.aborted) cleanup();
      else cleanups.add(cleanup);
      return () => cleanups.delete(cleanup);
    },
    attachView(next: { reset(): void; dispose(): void }) {
      assertLive();
      if (view === next) return;
      view?.dispose();
      view = next;
      modes.hidden = false;
    },
    dispose,
  };

  function assertLive() {
    if (abort.signal.aborted) throw new Error(`Scene "${title}" has been disposed`);
  }
  function attachController<P, K extends string, S>(controller: Story<P, K, S>) {
    assertLive();
    for (const { key } of parameters) {
      if (
        !controller.values ||
        typeof controller.values !== 'object' ||
        !(key in controller.values)
      )
        throw new Error(`Scene "${title}": parameter "${key}" is missing from stateAt()`);
    }
    const segments = controller.sheet.script.segments;
    const track = captionTrack(
      {
        segments: captions ? segments : segments?.map(({ words: _words, ...chapter }) => chapter),
        captionAliases: controller.sheet.script.captionAliases,
      },
      captions === true ? {} : captions,
    );
    player?.dispose();
    media?.pause();
    media = { pause: controller.player.pause };
    transition = (next) => {
      if (exploration === 'model' && controller.mode !== next) {
        if (next === 'explore') controller.explore(controller.values);
        else controller.resume();
      }
    };
    const ui = statePlayer(controls, {
      transport: controller.player,
      stops: controller.sheet.script.segments?.map((s) => s.start),
      captions: { element: caption, track },
      onSeek: controller.seek,
      onPlay: preparePlayback,
    });
    inputStory = (key, value) => controller.explore({ ...controller.values, [key]: value });
    const chapters = chapterHeading(
      heading,
      controller.sheet.script.segments ?? [],
      controller.seek,
    );
    const stopSeeking = controller.onSeek(() => {
      view?.reset();
      setMode('story');
    });
    // Layout can change the stage height. Render outside ResizeObserver delivery so
    // that surface.resize() cannot create a same-frame observation loop.
    let layoutFrame = 0;
    const layout = new ResizeObserver(() => {
      if (layoutFrame) return;
      layoutFrame = requestAnimationFrame(() => {
        layoutFrame = 0;
        controller.update();
      });
    });
    layout.observe(stage);
    let unsubscribe = () => {};
    player = {
      dispose() {
        layout.disconnect();
        cancelAnimationFrame(layoutFrame);
        unsubscribe();
        ui.dispose();
        chapters.dispose();
        stopSeeking();
        controller.dispose();
      },
    };
    storyButton.hidden = false;
    modes.hidden = !parameters.length && !view;
    unsubscribe = controller.subscribe((next, state) => {
      if (next === 'story') status.textContent = '';
      if (exploration === 'model') setMode(next);
      for (const { key } of parameters) values[key] = (state as Record<string, ControlValue>)[key]!;
      refresh();
      chapters.update(controller.currentTime, exploration === 'view' || next === 'story');
    });
    setMode('story');
    const handle: SceneHandle = {
      play: () => {
        preparePlayback();
        return controller.player.play();
      },
      seek: controller.seek,
      pause: controller.pause,
      review: controller.review,
      duration: controller.duration,
      get currentTime() {
        return controller.currentTime;
      },
      snapshot: () => controller.state,
      presentation: () => inspectPresentation(stage),
      setReduced: controller.setReduced,
      dispose,
    };
    Object.assign(root, { scene: handle });
    return handle;
    function preparePlayback() {
      if (controller.currentTime >= controller.duration - 0.02) view?.reset();
      if (exploration === 'model') setMode('story');
      else controller.resume();
    }
  }

  function dispose() {
    if (abort.signal.aborted) return;
    abort.abort();
    for (const cleanup of cleanups) cleanup();
    cleanups.clear();
    player?.dispose();
    view?.dispose();
    for (const control of inputs.values()) control.dispose();
    root.replaceChildren();
    inputStory = undefined;
    Reflect.deleteProperty(root, 'scene');
  }
}
export const SceneShell = { mount, ready: loadFonts };
