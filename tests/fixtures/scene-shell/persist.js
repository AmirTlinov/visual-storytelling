import './camera.js';
import { widgetState } from '@visual-storytelling/core';
window.galleryReady = window.galleryReady.then(async () => {
  const root = document.querySelector('.ve-scene');
  const saved = widgetState(
    'shell-regression',
    (value) => value?.privateContent && root.scene.restore(value.privateContent),
  );
  if (saved.read()?.privateContent) await root.scene.restore(saved.read().privateContent);
  const save = () => saved.save({ privateContent: root.scene.capture() });
  root.addEventListener('input', save);
  root.scene.shell.onDispose(() => {
    root.removeEventListener('input', save);
    saved.dispose();
  });
});
