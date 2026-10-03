import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, extname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { transform } from 'esbuild';
import { inlineResources } from './inline-resources.mjs';
import { readCatalog } from './catalog.mjs';

async function inlineAudio(file, bitrate) {
  const directory = await mkdtemp(join(tmpdir(), 'visual-story-audio-'));
  try {
    const output = join(directory, 'narration.webm');
    // A seekable output lets the muxer finalize duration and cue indexes.
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      file,
      '-c:a',
      'libopus',
      '-b:a',
      bitrate,
      output,
    ]);
    return `data:audio/webm;base64,${(await readFile(output)).toString('base64')}`;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
/** Inline a built scene. Compression is opt-in for the chat surface; files preserve the original audio. */
export async function packDirectory(
  directory,
  page = 'index.html',
  { inline = false, theme = 'auto' } = {},
) {
  if (!['auto', 'light', 'dark'].includes(theme)) throw new Error('Choose auto, light or dark');
  const root = resolve(directory);
  const resources = inlineResources(root);
  const base = dirname(resolve(root, page));
  const local = (url) => resources.local(url, base);
  const data = (url) => resources.data(url, base);
  let html = await readFile(join(root, page), 'utf8');
  // A silent draft keeps its media hook, without shipping the sample's unused recording.
  html = html.replace(
    /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<audio\b([^>]*)>[\s\S]*?<\/audio\s*>/gi,
    (markup, raw, attrs) => {
      if (raw || !/\bdata-silent\s*=\s*(["'])true\1/i.test(attrs)) return markup;
      return `<audio${attrs.replace(/\s(?:data-)?src\s*=\s*(["'])[\s\S]*?\1/gi, '')}></audio>`;
    },
  );
  if (page.endsWith('.svg'))
    html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}body>svg{display:block;width:100%;height:auto}</style></head><body>${html.replace(/<\?xml[^>]*>/, '')}</body></html>`;
  html = await resources.markup(html, base);
  for (const match of [
    ...html.matchAll(/<script\b([^>]*?)\ssrc=(["'])([^"']+)\2[^>]*>\s*<\/script>/gi),
  ]) {
    let code = await readFile(local(match[3]), 'utf8');
    if (inline) code = (await transform(code, { minify: true, legalComments: 'inline' })).code;
    html = html.replace(
      match[0],
      () => `<script ${match[1]}>${code.replaceAll('</script', '<\\/script')}</script>`,
    );
  }
  const escape = (value) =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  for (const match of [
    ...html.matchAll(/<object\b([^>]*?)\sdata=(["'])([^"']+)\2([^>]*)>\s*<\/object>/gi),
  ])
    if (!match[3].startsWith('data:')) {
      const file = local(match[3]);
      const svg = await resources.markup(
        (await readFile(file, 'utf8')).replace(/<\?xml[^>]*>/, ''),
        dirname(file),
      );
      const document = `<!doctype html><html style="color-scheme:${theme === 'auto' ? 'light dark' : theme}"><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}body>svg{display:block;width:100%;height:100%}${theme === 'auto' ? '' : `:root,.ve-scene{color-scheme:${theme}!important}`}</style></head><body>${svg}</body></html>`;
      const attrs = (match[1] + match[4]).replace(/\btype=(["'])[^"']*\1/i, '');
      const styled = /\bstyle=["']/i.test(attrs)
        ? attrs.replace(/\bstyle=(["'])/i, 'style=$1border:0;')
        : attrs + ' style="border:0"';
      html = html.replace(
        match[0],
        () => `<iframe data-scene-svg ${styled} srcdoc="${escape(document)}"></iframe>`,
      );
    }
  html = html.replace(
    /<style>([\s\S]*?)<\/style>/g,
    (_, css) =>
      `<style>${css.replace(/(?<![-\w])object(?![-\w])/g, 'iframe[data-scene-svg]')}</style>`,
  );
  if (theme !== 'auto')
    html = html.replace(
      '</head>',
      `<style>:root,.ve-scene{color-scheme:${theme}!important}</style></head>`,
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
  const audio = [...html.matchAll(/<audio\b[^>]*\s(?:src|data-src)=(["'])([^"']+)\1[^>]*>/gi)];
  for (const bitrate of inline ? ['40k', '32k', '24k'] : [null]) {
    let result = html;
    for (const match of audio)
      if (!match[2].startsWith('data:')) {
        const url =
          bitrate && extname(match[2]) === '.wav'
            ? await inlineAudio(local(match[2]), bitrate)
            : await data(match[2]);
        result = result.replace(match[0], match[0].replace(match[2], url));
      }
    if (!inline) return result;
    // The renderer consumes a fragment; keep the same main, styles, scripts and attribution.
    let inHead = false;
    result = result.replace(
      /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<!doctype[^>]*>|<\/?(html|head|body)\b[^>]*>|<title\b[^>]*>[\s\S]*?<\/title>/gi,
      (token, raw, wrapper) => {
        // SVG titles and markup inside code/styles are part of the scene.
        if (raw) return token;
        if (wrapper?.toLowerCase() === 'head') inHead = !token.startsWith('</');
        if (/^<title\b/i.test(token)) return inHead ? '' : token;
        return '';
      },
    );
    if (Buffer.byteLength(result) <= 1_000_000) return result;
    if (bitrate === '24k')
      throw new Error(
        `Inline result exceeds 1 MB (${Buffer.byteLength(result)} bytes). Use the standalone HTML file; no output was overwritten.`,
      );
  }
}
export async function standalone(scene, theme = 'auto') {
  const catalog = await readCatalog();
  if (!catalog[scene]) throw new Error('Unknown scene');
  return packDirectory(
    new URL(`../site/${scene}/`, import.meta.url).pathname,
    catalog[scene].page,
    { theme },
  );
}
