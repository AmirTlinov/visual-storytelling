import frameClient from './scene-frame.mjs' with { type: 'text' };

export function sceneDocument(html, config) {
  const setup = `<script>window.__visualStorySession=${JSON.stringify(config).replaceAll('<', '\\u003c')}</script>`;
  const adapter = `<script>${frameClient.replace(/<\/script/gi, '<\\/script')}</script>`;
  return html.replace('</head>', () => setup + adapter + '</head>');
}
