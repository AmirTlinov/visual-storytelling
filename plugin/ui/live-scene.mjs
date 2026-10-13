import { mountStoryDocument } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';

// The installed bundle supplies components; this authored document supplies the subject.
const documentReady =
  document.readyState === 'loading'
    ? new Promise((resolve) =>
        document.addEventListener('DOMContentLoaded', resolve, { once: true }),
      )
    : Promise.resolve();
window.galleryReady = documentReady.then(() =>
  mountStoryDocument(document.querySelector('main'), window.__visualStoryDocument, {
    audio: document.querySelector('audio[data-story-audio]'),
  }),
);
