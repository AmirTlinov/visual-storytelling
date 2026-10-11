import { SceneShell, widgetState } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';
window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.querySelector('.ve-scene');
  const shell = SceneShell.mount(root, {
    title: 'Subject checkpoint',
    parameters: [{ key: 'x', label: 'X', value: 1, min: 0, max: 20 }],
  });
  const output = document.createElement('output');
  shell.stage.append(output);
  const story = shell.attachStory({
    script: { duration: 10, cues: { all: { start: 0, end: 10 } } },
    stateAt: (frame) => ({ x: frame.time + 1, trace: [{ sample: frame.time }] }),
    checkpoint: {
      encode: (input) => ({ version: 1, input }),
      decode(value) {
        if (value?.version !== 1 || !Array.isArray(value.input?.trace))
          throw new Error('Unknown subject schema');
        return structuredClone(value.input);
      },
    },
    derive: (input) => ({
      ...input,
      total: input.x + input.trace.reduce((sum, item) => sum + item.sample, 0),
    }),
    render: (model) => {
      output.textContent = `${model.x} + ${model.trace.map((item) => item.sample).join(' + ')} = ${model.total}`;
    },
  });
  const bridge = widgetState(
    'subject-checkpoint',
    (value) => value.privateContent && root.scene.restore(value.privateContent),
  );
  if (bridge.read()?.privateContent) await root.scene.restore(bridge.read().privateContent);
  root.scene.extend({
    shell,
    story,
    explore(input) {
      story.explore(input);
      bridge.save({ privateContent: root.scene.capture() });
    },
  });
  shell.onDispose(() => bridge.dispose());
})();
