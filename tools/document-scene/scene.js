import { IllustratedStory } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';
import storyDocument from './story.json';

window.galleryReady = Promise.resolve().then(() =>
  IllustratedStory.mount(document.querySelector('main'), {
    document: storyDocument,
    audio: document.querySelector('audio[data-story-audio]'),
  }),
);
