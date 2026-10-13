import { IllustratedStory } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';

// Runtime components and authored inputs enter through the same public document owner.
window.galleryReady = Promise.resolve().then(() =>
  IllustratedStory.mount(document.querySelector('main'), { document: window.__visualStoryDocument }),
);
