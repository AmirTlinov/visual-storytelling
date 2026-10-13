import { IllustratedStory } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';
window.galleryReady = IllustratedStory.mount(document.querySelector('main'), {
  document: {
    recipe: 'division',
    inputs: { count: 17, divisor: 5 },
    views: [
      { id: 'objects', kind: 'groups', model: 'division' },
      { id: 'identity', kind: 'equation', model: 'division' },
    ],
  },
});
