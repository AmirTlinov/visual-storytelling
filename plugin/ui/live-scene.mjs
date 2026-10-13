import { mountExplanation } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';

// The installed bundle supplies components; this authored document supplies the subject.
window.galleryReady = Promise.resolve().then(() =>
  mountExplanation(document.querySelector('main'), window.__visualStoryExplanation),
);
