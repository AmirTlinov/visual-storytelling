import { SmilPlayer } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';
window.galleryReady = SmilPlayer.mount(document.querySelector('.ve-scene'), { duration: 4 }).ready;
