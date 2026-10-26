import { IllustratedStory } from '@visual-storytelling/core/story';
import { spatialChapter } from './presentation.js';
import story from './story.json' with { type: 'json' };
import '@visual-storytelling/core/style.css';

window.galleryReady = IllustratedStory.mount(document.querySelector('main'), {
  document: story,
  audio: document.querySelector('[data-story-audio]'),
  heading: 'navigation',
  captions: { placement: 'overlay', maxChars: 70, lineChars: 36 },
  parameters: [
    {
      key: 'reserve',
      label: 'Запасной путь',
      type: 'select',
      value: 'none',
      options: [
        { value: 'none', label: 'Основной' },
        { value: 'shared', label: 'Общий резерв' },
        { value: 'independent', label: 'Независимый резерв' },
      ],
    },
    { key: 'disabled-provider', label: 'Отказ провайдера А', type: 'toggle', value: false },
    { key: 'disabled-bank', label: 'Отказ банка', type: 'toggle', value: false },
  ],
  chapters: {
    geography: (chapter) => spatialChapter(chapter, 'geography', story.models[0]),
    network: (chapter) => spatialChapter(chapter, 'network', story.models[0]),
    whole: (chapter) => spatialChapter(chapter, 'whole', story.models[0]),
  },
}).then((result) => {
  window.storyScene = result;
  return result;
});
