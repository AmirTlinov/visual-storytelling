import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { transform } from 'esbuild';
const mime = {
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webm': 'audio/webm',
};
/** Inline a built scene. Compression is opt-in for the chat surface; files preserve the original audio. */
export async function packDirectory(directory, page = 'index.html', { inline = false } = {}) {
  const root = resolve(directory);
  const local = (url) => {
    const p = resolve(root, url);
    if (!p.startsWith(root + '/'))
      throw new Error('A standalone scene may only embed its own resources');
    return p;
  };
  const data = async (url) =>
    `data:${mime[extname(url)] ?? 'application/octet-stream'};base64,${(await readFile(local(url))).toString('base64')}`;
  let html = await readFile(join(root, page), 'utf8');
  for (const match of [...html.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g)]) {
    let css = await readFile(local(match[1]), 'utf8');
    for (const asset of [...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)])
      if (!asset[1].startsWith('data:'))
        css = css.replace(asset[0], `url('${await data(join(dirname(match[1]), asset[1]))}')`);
    html = html.replace(match[0], `<style>${css}</style>`);
  }
  for (const match of [...html.matchAll(/<script\b([^>]*)src="([^"]+)"[^>]*><\/script>/g)]) {
    let code = await readFile(local(match[2]), 'utf8');
    if (inline) code = (await transform(code, { minify: true, legalComments: 'inline' })).code;
    html = html.replace(
      match[0],
      `<script ${match[1]}>${code.replaceAll('</script', '<\\/script')}</script>`,
    );
  }
  for (const match of [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/g)])
    if (!match[1].startsWith('data:'))
      html = html.replace(match[0], match[0].replace(match[1], await data(match[1])));
  const escape = (value) =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  for (const match of [...html.matchAll(/<object\b([^>]*?)\bdata="([^"]+)"([^>]*)><\/object>/g)])
    if (!match[2].startsWith('data:')) {
      const svg = (await readFile(local(match[2]), 'utf8')).replace(/<\?xml[^>]*>/, '');
      const document = `<!doctype html><html style="color-scheme:light dark"><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}body>svg{display:block;width:100%;height:100%}</style></head><body>${svg}</body></html>`;
      const attrs = (match[1] + match[3]).replace(/type="[^"]*"/, '');
      html = html.replace(
        match[0],
        `<iframe data-scene-svg ${attrs} srcdoc="${escape(document)}" style="border:0"></iframe>`,
      );
    }
  html = html.replace(
    /<style>([\s\S]*?)<\/style>/g,
    (_, css) => `<style>${css.replace(/\bobject\b/g, 'iframe[data-scene-svg]')}</style>`,
  );
  const notices = [];
  for (const path of [
    join(root, 'CREDITS.txt'),
    new URL('../THIRD_PARTY.md', import.meta.url),
    new URL('../dist/assets/shantell-OFL.txt', import.meta.url),
  ]) {
    try {
      notices.push(await readFile(path, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  html += '\n<!--\n' + notices.join('\n\n').replaceAll('--', '—') + '\n-->\n';
  const audio = [...html.matchAll(/<audio\b[^>]*\b(src|data-src)="([^"]+)"[^>]*>/g)];
  for (const bitrate of inline ? ['40k', '32k', '24k'] : [null]) {
    let result = html;
    for (const match of audio)
      if (!match[2].startsWith('data:')) {
        const url =
          bitrate && extname(match[2]) === '.wav'
            ? `data:audio/webm;base64,${execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', local(match[2]), '-c:a', 'libopus', '-b:a', bitrate, '-f', 'webm', 'pipe:1'], { maxBuffer: 64 * 1024 * 1024 }).toString('base64')}`
            : await data(match[2]);
        result = result.replace(match[0], match[0].replace(match[2], url));
      }
    if (!inline) return result;
    // The renderer consumes a fragment; keep the same main, styles, scripts and attribution.
    result = result.replace(
      /<!doctype[^>]*>|<\/?html\b[^>]*>|<\/?head>|<\/?body\b[^>]*>|<title>[\s\S]*?<\/title>/gi,
      '',
    );
    if (Buffer.byteLength(result) <= 1_000_000) return result;
    if (bitrate === '24k')
      throw new Error(
        `Inline result exceeds 1 MB (${Buffer.byteLength(result)} bytes). Use the standalone HTML file; no output was overwritten.`,
      );
  }
}
export async function standalone(scene, theme = 'auto') {
  const catalog = JSON.parse(
    await readFile(new URL('../examples/catalog.json', import.meta.url), 'utf8'),
  );
  if (!catalog[scene]) throw new Error('Unknown scene');
  let html = await packDirectory(resolve('site', scene), catalog[scene].page);
  if (theme !== 'auto')
    html = html.replace(
      '</head>',
      `<style>:root,svg.ve-scene{color-scheme:${theme}}</style></head>`,
    );
  return html;
}
