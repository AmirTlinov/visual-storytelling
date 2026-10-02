import type {SceneHandle} from '@visual-storytelling/core';
declare global {interface Window {explainer:SceneHandle;galleryReady:Promise<void>}}
