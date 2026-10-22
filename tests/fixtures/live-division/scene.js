import { mountExplanation } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';
window.galleryReady = mountExplanation(document.querySelector('main'), {
  version: 1,
  model: { id: 'division', kind: 'division', count: 17, divisor: 5 },
  views: [
    { id: 'objects', kind: 'groups', model: 'division' },
    { id: 'identity', kind: 'equation', model: 'division' },
  ],
});
