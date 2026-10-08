import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, extname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { transform } from 'esbuild';
import { parse } from 'parse5';
import { inlineResources } from './inline-resources.mjs';
import { readCatalog } from './catalog.mjs';
import { standaloneAssetURLs } from './asset-urls.mjs';

const execute = promisify(execFile);
const attribute = (node, name) => node.attrs?.find((attr) => attr.name === name)?.value;
function elements(html, tag) {
  const nodes = [];
  const visit = (node) => {
    if (node.tagName === tag) nodes.push(node);
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content) visit(node.content);
  };
  visit(parse(html, { sourceCodeLocationInfo: true }));
  return nodes;
}
const audioElements = (html) => elements(html, 'audio');
/** Restore a portable observation through the existing SceneHandle after its authored startup. */
export function withCheckpoint(html, checkpoint) {
  if (!checkpoint) return html;
  const value = JSON.stringify(checkpoint).replaceAll('<', '\\u003c');
  const script = `<script type="module">window.galleryReady=Promise.resolve(window.galleryReady).then(async()=>{await document.fonts.ready;const scene=document.querySelector('.ve-scene')?.scene;if(!scene?.restore)throw new Error('Saved conditions require SceneHandle.restore');scene.pause?.();await scene.restore(${value});await scene.ready?.();});</script>`;
  return html.includes('</body>')
    ? html.replace('</body>', () => script + '</body>')
    : html + script;
}
function replaceSpans(html, edits) {
  const unique = [...new Map(edits.map((edit) => [edit[0].startOffset, edit])).values()];
  for (const [span, text] of unique.sort((a, b) => b[0].startOffset - a[0].startOffset))
    html = html.slice(0, span.startOffset) + text + html.slice(span.endOffset);
  return html;
}
async function inlineAudio(file, bitrate, signal) {
  const directory = await mkdtemp(join(tmpdir(), 'visual-story-audio-'));
  try {
    const output = join(directory, 'narration.m4a');
    // A seekable output lets the muxer finalize duration and cue indexes.
    await execute(
      'ffmpeg',
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        file,
        '-c:a',
        'aac',
        '-b:a',
        bitrate,
        output,
      ],
      { signal },
    );
    return `data:audio/mp4;base64,${(await readFile(output)).toString('base64')}`;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
/** Delivery audio is compressed in both containers. Source recordings stay in the authoring project. */
export async function packDirectory(
  directory,
  page = 'index.html',
  { inline = false, theme = 'auto', audio = 'compressed', signal } = {},
) {
  signal?.throwIfAborted();
  if (!['auto', 'light', 'dark'].includes(theme)) throw new Error('Choose auto, light or dark');
  if (!['compressed', 'original'].includes(audio))
    throw new Error('Choose compressed or original audio');
  const root = resolve(directory);
  const resources = inlineResources(root);
  const base = dirname(resolve(root, page));
  const local = (url) => resources.local(url, base);
  const data = (url) => resources.data(url, base);
  let html = await readFile(join(root, page), 'utf8');
  // A silent draft keeps its media hook, without shipping the sample's unused recording.
  const silentEdits = [];
  for (const node of audioElements(html))
    if (attribute(node, 'data-silent') === 'true') {
      for (const name of ['src', 'data-src']) {
        const span = node.sourceCodeLocation?.attrs?.[name];
        if (span) silentEdits.push([span, '']);
      }
      for (const child of node.childNodes ?? [])
        if (child.tagName === 'source' && child.sourceCodeLocation)
          silentEdits.push([child.sourceCodeLocation, '']);
    }
  html = replaceSpans(html, silentEdits);
  if (page.endsWith('.svg'))
    html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}body>svg{display:block;width:100%;height:auto}</style></head><body>${html.replace(/<\?xml[^>]*>/, '')}</body></html>`;
  html = await resources.markup(html, base);
  const scriptEdits = [];
  const notices = new Set();
  for (const node of elements(html, 'script')) {
    if (
      !['', 'module', 'text/javascript', 'application/javascript'].includes(
        (attribute(node, 'type') ?? '').trim().toLowerCase(),
      )
    )
      continue;
    const location = node.sourceCodeLocation;
    if (!location) continue;
    const src = attribute(node, 'src');
    if (src) {
      try {
        notices.add(await readFile(local(src) + '.LICENSE.txt', 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    let code = src
      ? await readFile(local(src), 'utf8')
      : html.slice(location.startTag.endOffset, location.endTag?.startOffset ?? location.endOffset);
    code = await standaloneAssetURLs(code, resources, base);
    if (inline) code = (await transform(code, { minify: true, legalComments: 'inline' })).code;
    const startTag = html.slice(location.startTag.startOffset, location.startTag.endOffset);
    const span = location.attrs?.src;
    const opening = span
      ? startTag.slice(0, span.startOffset - location.startOffset) +
        startTag.slice(span.endOffset - location.startOffset)
      : startTag;
    scriptEdits.push([location, `${opening}${code.replace(/<\/script/gi, '<\\/script')}</script>`]);
  }
  html = replaceSpans(html, scriptEdits);
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
  for (const path of [
    join(root, 'CREDITS.txt'),
    new URL('../THIRD_PARTY.md', import.meta.url),
    new URL('../dist/assets/shantell-OFL.txt', import.meta.url),
  ]) {
    try {
      notices.add(await readFile(path, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  html += '\n<!--\n' + [...notices].join('\n\n').replaceAll('--', '—') + '\n-->\n';
  const recordings = audioElements(html).flatMap((node) =>
    [node, ...(node.childNodes ?? []).filter((child) => child.tagName === 'source')].flatMap(
      (element) =>
        (element.attrs ?? [])
          .filter((attr) => ['src', 'data-src'].includes(attr.name))
          .map((attr) => ({
            name: attr.name,
            url: attr.value,
            span: element.sourceCodeLocation.attrs[attr.name],
            type: element.sourceCodeLocation.attrs.type,
          })),
    ),
  );
  for (const bitrate of audio === 'original' ? [null] : inline ? ['40k', '32k', '24k'] : ['96k']) {
    const edits = [],
      embedded = new Map();
    for (const recording of recordings)
      if (!recording.url.startsWith('data:')) {
        const file = local(recording.url);
        const compressed =
          bitrate && ['.wav', '.aiff', '.aif', '.flac'].includes(extname(file).toLowerCase());
        if (!embedded.has(file))
          embedded.set(
            file,
            compressed ? await inlineAudio(file, bitrate, signal) : await data(recording.url),
          );
        edits.push([recording.span, `${recording.name}="${embedded.get(file)}"`]);
        if (compressed && recording.type) edits.push([recording.type, 'type="audio/mp4"']);
      }
    let result = replaceSpans(html, edits);
    signal?.throwIfAborted();
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
    if (bitrate === '24k' || audio === 'original')
      throw new Error(
        `Inline result exceeds 1 MB (${Buffer.byteLength(result)} bytes). Use the standalone HTML file; no output was overwritten.`,
      );
  }
}
export async function standalone(scene, theme = 'auto', { signal } = {}) {
  const catalog = await readCatalog();
  if (!catalog[scene]) throw new Error('Unknown scene');
  return packDirectory(
    new URL(`../site/${scene}/`, import.meta.url).pathname,
    catalog[scene].page,
    { theme, signal },
  );
}
