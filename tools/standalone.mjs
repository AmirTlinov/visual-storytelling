import { readFile, readdir } from 'node:fs/promises';
const mime = { m4a: 'audio/mp4', woff2: 'font/woff2', png: 'image/png', svg: 'image/svg+xml' };
export async function standalone(scene, theme = 'auto') {
  let html = await readFile('site/index.html', 'utf8');
  const script = /\s*<script\b[^>]*src="([^"]+)"[^>]*><\/script>/;
  const style = /\s*<link\b[^>]*href="([^"]+\.css)"[^>]*>/;
  const jsFile = script.exec(html)?.[1],
    cssFile = style.exec(html)?.[1];
  if (!jsFile || !cssFile) throw new Error('Build the gallery before exporting HTML');
  let js = await readFile(`site${jsFile}`, 'utf8'),
    css = await readFile(`site${cssFile}`, 'utf8');
  for (const file of await readdir('site/assets')) {
    const type = mime[file.split('.').pop()];
    if (!type) continue;
    const data = `data:${type};base64,${(await readFile(`site/assets/${file}`)).toString('base64')}`;
    js = js.replaceAll(`/assets/${file}`, data);
    css = css.replaceAll(`/assets/${file}`, data);
  }
  // This is an embedded default, so file:// needs neither routing nor a server.
  const config = `<script>window.STORY_DEFAULTS=${JSON.stringify({ scene, theme, standalone: true })}</script>`;
  html = html.replace(script, '').replace(style, '');
  return html
    .replace('</head>', `<style>${css}</style>${config}</head>`)
    .replace(
      '</body>',
      `<script type="module">${js.replaceAll('</script', '<\\/script')}</script></body>`,
    );
}
