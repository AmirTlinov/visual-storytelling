import { CharacterStory } from '@visual-storytelling/core/characters';
import '@visual-storytelling/core/style.css';
import { experiment } from './experiment.js';

window.galleryReady = CharacterStory.mount(document.getElementById('press-reaction'), experiment);
