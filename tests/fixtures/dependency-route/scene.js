import { IllustratedStory } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';
window.galleryReady = IllustratedStory.mount(document.querySelector('main'), {
  document: {
    recipe: 'dependency-route',
    inputs: { orderId: '417', reserve: 'shared', 'disabled-provider': true },
  },
});
