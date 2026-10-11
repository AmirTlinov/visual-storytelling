import { SceneShell, surface } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';

window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.querySelector('main');
  const shell = SceneShell.mount(root, { title: document.title });
  const drawing = surface(shell.stage, {
    id: 'drawing',
    title: document.title,
    description: '',
    width: shell.stage.clientWidth,
    height: shell.stage.clientHeight,
    grid: false,
  });
  shell.onDispose(drawing.dispose);
  // Add the subject's geometry to drawing.layer and its behavior through shell.attachStory().
})();
