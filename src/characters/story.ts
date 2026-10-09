import { SceneShell } from '../scene.js';
import { widgetState } from '../host/widget-state.js';
import { compileScore } from './score.js';
import { characterStage } from './stage.js';
import type { CharacterStoryOptions } from './types.js';

async function mount(root: HTMLElement, options: CharacterStoryOptions) {
  root.querySelector(':scope > [data-character-error]')?.remove();
  let cleanup: (() => void) | undefined;
  try {
    const score = compileScore(options);
    await SceneShell.ready();
    const parameters =
      options.explore === false
        ? []
        : [
            {
              key: 'beat',
              label: 'Действие',
              type: 'select' as const,
              value: options.beats[0]!.id,
              options: options.beats.map((b) => ({ value: b.id, label: b.title ?? b.text })),
            },
            {
              key: 'progress',
              label: 'Момент действия',
              value: 0,
              min: 0,
              max: 1,
              step: 0.005,
              format: (value: unknown) => `${Math.round(Number(value) * 100)}%`,
            },
          ];
    const shell = SceneShell.mount(root, {
      title: options.title,
      paper: false,
      parameters,
    });
    cleanup = shell.dispose;
    const drawing = await characterStage(shell.stage, options, score);
    shell.onDispose(drawing.dispose);
    const story = shell.attachStory({
      script: score.script,
      audio: options.audio,
      stateAt: (frame) => {
        const beat =
          options.beats.findLast((b) => score.script.cues[b.id]!.start <= frame.time) ??
          options.beats[0]!;
        const cue = score.script.cues[beat.id]!;
        return {
          beat: beat.id,
          progress: Math.max(0, Math.min(1, (frame.time - cue.start) / (cue.end - cue.start))),
        };
      },
      render(values, frame, mode) {
        const cue = score.script.cues[values.beat];
        if (!cue) throw new Error(`Unknown action: ${values.beat}`);
        const time =
          mode === 'explore'
            ? Math.min(cue.end - 1e-6, cue.start + values.progress * (cue.end - cue.start))
            : frame.time;
        drawing.render(time, frame.reduced);
        for (const beat of options.beats) {
          frame.has(beat.id);
          frame.target(beat.id, 'cast');
          for (const prop of Object.keys(beat.props ?? {})) frame.target(beat.id, prop);
        }
      },
    });
    root.scene!.snapshot = drawing.snapshot;
    shell.attachView({ ...drawing.view, dispose() {} });
    root.scene!.checkpoints = options.beats.map((beat) => score.script.cues[beat.id]!.start);
    if (options.remember) {
      let restoring = false,
        previous = 0;
      const restore = (saved: { privateContent?: unknown } | null | undefined) => {
        const value = saved?.privateContent as
          | { version?: number; time?: number; title?: string }
          | undefined;
        if (value?.version !== 1 || value.title !== options.title || !Number.isFinite(value.time))
          return;
        restoring = true;
        try {
          story.pause();
          story.seek(value.time!);
          previous = story.currentTime;
        } finally {
          restoring = false;
        }
      };
      const state = widgetState(options.remember, restore);
      restore(state.read());
      previous = story.currentTime;
      const save = () => {
        if (restoring || previous === story.currentTime) return;
        previous = story.currentTime;
        state.save({
          modelContent: { story: options.title, time: previous },
          privateContent: { version: 1, title: options.title, time: previous },
        });
      };
      const unsubscribe = story.player.subscribe((value) => {
        if (!value.playing) save();
      });
      window.addEventListener('pagehide', save);
      shell.onDispose(() => {
        save();
        unsubscribe();
        state.dispose();
        window.removeEventListener('pagehide', save);
      });
    }
    return { scene: root.scene!, shell, story };
  } catch (error) {
    cleanup?.();
    const message = document.createElement('p');
    message.dataset.characterError = '';
    message.setAttribute('role', 'alert');
    message.textContent = `Не удалось открыть персонажей: ${error instanceof Error ? error.message : String(error)}`;
    root.append(message);
    throw error;
  }
}
export const CharacterStory = { mount };
