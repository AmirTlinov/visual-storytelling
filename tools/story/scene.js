import { mountStoryDocument } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';
import authored from './story.json';

window.galleryReady = Promise.resolve().then(() =>
  mountStoryDocument(document.querySelector('main'), authored, {
    audio: document.querySelector('audio[data-story-audio]'),
  }),
);
