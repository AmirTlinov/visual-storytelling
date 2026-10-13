import { mountStoryDocument } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';
import authored from './story.json';

window.galleryReady = mountStoryDocument(document.querySelector('main'), authored);
