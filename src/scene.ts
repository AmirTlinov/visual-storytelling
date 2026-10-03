import { story, type Story, type StoryOptions } from './story/story.js';
import { chapterHeading } from './story/chapters.js';
import { loadFonts } from './ink/fonts.js';
import { player as statePlayer } from './controls/player.js';
import type { MediaClock } from './story/clock.js';
import type { SceneHandle } from './scene-handle.js';
export type { SceneHandle } from './scene-handle.js';
export interface SceneOptions {
  title: string;
  paper?: boolean;
  parameters?: (ControlParameter & { key: string })[];
  onInput?: (values: Record<string, ControlValue>) => void;
  onMode?: (mode: 'story' | 'explore') => void;
  /** View-only exploration leaves narration and model time running. */
  exploration?: 'model' | 'view';
}
import { SketchControls, type ControlParameter, type ControlValue } from './controls/fields.js';
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
    paper = true,
    parameters = [],
    onInput = () => {},
    onMode = () => {},
    exploration = 'model',
  }: SceneOptions,
) {
  const abort = new AbortController(),
    options = { signal: abort.signal };
  const cleanups = new Set<() => void>();
  const values = Object.fromEntries(parameters.map((p) => [p.key, p.value]));
  let inputStory: ((key: string, value: ControlValue) => void) | undefined;
  let view: { reset(): void; dispose(): void } | undefined;
  const heading = node('h1', {}, title),
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
      values[p.key] = value;
      if (inputStory) inputStory(p.key, value);
      else setMode('explore');
      refresh();
      onInput({ ...values });
    });
    fields.append(control.element);
    inputs.set(p.key, control);
  }
  const actions = node('div', { class: 've-view-actions' }),
    controls = node('div', { 'data-player': '', hidden: '' });
  const caption = node('p', { class: 'caption sr-only', 'data-caption': '', role: 'status' }),
    status = node('p', { class: 've-status', role: 'alert' });
  root.append(heading, modes, actions, stage, fields, controls, caption, status);
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
  root.dataset.paper = String(paper);
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
    attachStory<P, K extends string>(options: StoryOptions<P, K>) {
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
    /** Register subject-owned observers, animations and subscriptions for removal. */
    onDispose(cleanup: () => void) {
      if (abort.signal.aborted) cleanup();
      else cleanups.add(cleanup);
      return () => cleanups.delete(cleanup);
    },
    /** View gestures keep media running; mode buttons and seeking restore the authored shot. */
    attachView(next: { reset(): void; dispose(): void }) {
      if (view === next) return;
      view?.dispose();
      view = next;
      modes.hidden = false;
    },
    dispose,
  };

  function attachController<P, K extends string>(controller: Story<P, K>) {
    for (const { key } of parameters) {
      if (
        !controller.values ||
        typeof controller.values !== 'object' ||
        !(key in controller.values)
      )
        throw new Error(`Scene "${title}": parameter "${key}" is missing from stateAt()`);
    }
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
      captions: { element: caption, segments: controller.sheet.script.segments ?? [] },
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
    let unsubscribe = () => {};
    player = {
      dispose() {
        unsubscribe();
        ui.dispose();
        chapters.dispose();
        stopSeeking();
        controller.dispose();
      },
    };
    storyButton.hidden = false;
    modes.hidden = false;
    unsubscribe = controller.subscribe((next, state) => {
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
      snapshot: () => controller.values,
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
