import { IllustratedStory, SimulationMode } from '@visual-storytelling/core/story';
import { SketchControls } from '@visual-storytelling/core';
import { createBlockExperiment, validateInputs } from './model.js';
import { blockChapter } from './presentation.js';
import source from './story.json' with { type: 'json' };
import '@visual-storytelling/core/style.css';

window.galleryReady = (async () => {
  const physics = await createBlockExperiment();
  try {
    const document = structuredClone(source);
    if (new URL(location.href).searchParams.has('short')) {
      document.chapters = [document.chapters[0]];
      document.chapters[0].beats.push({
        id: 'try',
        seconds: 2,
        text: 'Что изменится при меньшем трении?',
      });
    }
    const shared = {
      experiment: physics,
      get active() {
        return shared.composition?.presentation?.live;
      },
    };
    const result = await IllustratedStory.mount(window.document.querySelector('main'), {
      document,
      modules: { 'push-block': physics.module },
      audio: window.document.querySelector('[data-story-audio]'),
      heading: 'navigation',
      captions: { placement: 'overlay', maxChars: 65, lineChars: 34 },
      parameters: [
        { key: 'angle', label: 'Угол, °', value: 8, min: 0, max: 30, step: 1 },
        { key: 'friction', label: 'Коэффициент трения', value: 0.55, min: 0, max: 1, step: 0.05 },
        { key: 'push', label: 'Сила, Н', value: 6, min: 0, max: 12, step: 1 },
      ],
      chapters: {
        trial: (c) => blockChapter(c, 'trial', shared),
        slide: (c) => blockChapter(c, 'trial', shared),
        measure: (c) => blockChapter(c, 'measure', shared),
      },
    });
    shared.composition = result;
    const { scene, shell, story } = result;
    shell.onDispose(physics.dispose);
    let elapsed = 0;
    const button = SketchControls.action('Живой опыт', async () => {
      if (mode.active) mode.leave();
      else await mode.enter();
    });
    const render = () => shared.active?.render(physics.liveState());
    const mode = SimulationMode.mount({
      scene,
      story,
      element: window.document.querySelector('[data-player]'),
      time: () =>
        shared.mode?.active ? physics.time : (shared.active?.snapshot().model.time ?? 0),
      snapshot: () => shared.active?.snapshot(),
      checkpoint: {
        start: () => ({
          time: shared.active.snapshot().model.time,
          inputs: {
            angle: shared.active.snapshot().model.angle,
            friction: shared.active.snapshot().model.friction,
            push: shared.active.snapshot().model.push,
          },
        }),
        capture: () => ({
          time: physics.time,
          inputs: {
            angle: physics.liveState().angle,
            friction: physics.liveState().friction,
            push: physics.liveState().push,
          },
        }),
        validate(value) {
          if (!value || !Number.isFinite(value.time) || value.time < 0 || value.time > 3 + 1e-8)
            throw Error('Invalid physical checkpoint.');
          validateInputs(value.inputs);
        },
        restore(value) {
          physics.seek(value.inputs, value.time);
        },
      },
      model: {
        prepare() {
          if (physics.time >= 3 - physics.world.stepSeconds / 2) {
            const { angle, friction, push } = physics.liveState();
            physics.seek({ angle, friction, push }, 0);
          }
          elapsed = 0;
        },
        advance(time) {
          const delta = (time - elapsed) / 1000;
          elapsed = time;
          return physics.world.advance(Math.min(delta, Math.max(0, 3 - physics.time)));
        },
        step: () => physics.world.step(),
        read: () => ({
          value: physics.time / 3,
          done: physics.time >= 3 - physics.world.stepSeconds / 2,
          canStep: physics.time < 3 - physics.world.stepSeconds / 2,
          stamp: `${physics.time.toFixed(1)} с`,
        }),
        render,
        commit() {},
      },
      onMode(live) {
        button.textContent = live ? 'К рассказу' : 'Живой опыт';
        const caption = window.document.querySelector('[data-caption]');
        if (caption) caption.hidden = live || shell.mode !== 'story';
        if (live) render();
      },
    });
    shared.mode = mode;
    shell.actions.append(button);
    window.storyScene = result;
    return result;
  } catch (cause) {
    physics.dispose();
    throw cause;
  }
})();
