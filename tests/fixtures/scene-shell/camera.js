import './scene.js';
import { ViewportSVG } from '@visual-storytelling/core';
window.galleryReady = window.galleryReady.then(() => {
  const scene = document.querySelector('.ve-scene').scene;
  const camera = ViewportSVG.mount(scene.drawing.element);
  scene.shell.attachView(camera);
  const { width, height } = scene.shell.layout;
  camera.shot({ target: { x: 0, y: 0, w: width, h: height }, padding: 0 });
});
