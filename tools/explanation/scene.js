import { mountExplanation } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';
import explanation from './explanation.json';

window.galleryReady = Promise.resolve().then(() =>
  mountExplanation(document.querySelector('main'), explanation),
);
