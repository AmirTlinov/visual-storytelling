import '@visual-storytelling/core/style.css';
import './drawing/art.css';
import './scene.css';
import { mountComputer } from './explorer.js';
window.galleryReady = document.fonts.ready.then(() => {
  const root = document.getElementById('computer-explorer');
  root.scene = window.explainer = mountComputer(root);
});
