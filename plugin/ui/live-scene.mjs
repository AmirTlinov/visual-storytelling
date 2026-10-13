import { IllustratedStory, documentRuntime } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';

// Runtime components and authored inputs enter through the same public document owner.
window.galleryReady = Promise.resolve().then(async () => {
  const custom = window.__visualStoryModuleFactory
    ? await window.__visualStoryModuleFactory(documentRuntime)
    : {};
  return IllustratedStory.mount(document.querySelector('main'), {
    document: window.__visualStoryDocument,
    audio: document.querySelector('[data-story-audio]'),
    ...custom,
  });
});
