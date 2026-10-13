import { IllustratedStory } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';

// Runtime components and authored inputs enter through the same public document owner.
window.galleryReady = (async () => {
  if (document.readyState === 'loading')
    await new Promise((resolve) =>
      document.addEventListener('DOMContentLoaded', resolve, { once: true }),
    );
  return IllustratedStory.mount(document.querySelector('main'), {
    document: window.__visualStoryDocument,
    audio: document.querySelector('audio[data-story-audio]'),
  });
})();
