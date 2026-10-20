import frameClient from './scene-frame.mjs' with { type: 'text' };
import { inStoryHead } from '../../tools/story-html.mjs';

export function sceneDocument(html, config) {
  if (!html) return html;
  const setup = `<script>window.__visualStorySession=${JSON.stringify(config).replaceAll('<', '\\u003c')}</script>`;
  const adapter = `<script>${frameClient.replace(/<\/script/gi, '<\\/script')}</script>`;
  return inStoryHead(html, setup + adapter);
}
