import { IllustratedStory } from '@visual-storytelling/core/story';
import { cubeModel } from './model.js';
import { cubeChapter } from './presentation.js';
import story from './story.json' with { type: 'json' };
import '@visual-storytelling/core/style.css';
window.galleryReady = IllustratedStory.mount(document.querySelector('main'), {
  document: story,
  audio: document.querySelector('[data-story-audio]'),
  modules: { 'cube-section': cubeModel },
  heading: 'navigation',
  captions: { placement: 'overlay', maxChars: 70, lineChars: 36 },
  parameters: [
    { key: 'offset', label: 'Положение сечения z', value: 0, min: -1.2, max: 1.2, step: 0.1 },
  ],
  chapters: {
    whole: (c) => cubeChapter(c, 'whole'),
    detail: (c) => cubeChapter(c, 'detail'),
    return: (c) => cubeChapter(c, 'return'),
  },
}).then((result) => {
  window.storyScene = result;
  return result;
});
