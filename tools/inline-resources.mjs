import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { parse } from 'parse5';
import { build } from 'esbuild';
import { mediaType } from './assets.mjs';

const escape = (value) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const embedded = (url) => /^(?:data:|#)/i.test(url.trim());

// A data URL may itself contain commas. Whitespace separates its optional descriptor.
async function srcset(value, embed) {
  const candidates = [];
  let rest = value;
  while ((rest = rest.replace(/^[\s,]+/, ''))) {
    const url = /^\S+/.exec(rest)[0];
    rest = rest.slice(url.length);
    if (url.endsWith(',')) {
      candidates.push(await embed(url.replace(/,+$/, '')));
      continue;
    }
    const descriptor = /^[^,]*/.exec(rest)[0];
    rest = rest.slice(descriptor.length);
    candidates.push(`${await embed(url)}${descriptor.trim() ? ` ${descriptor.trim()}` : ''}`);
  }
  return candidates.join(', ');
}

/** One resource resolver for HTML, SVG, stylesheets and nested images. Preserve authored markup. */
export function inlineResources(directory) {
  const root = resolve(directory);
  function local(url, base = root) {
    if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(url))
      throw new Error(`Cannot bundle remote resource: ${url}`);
    const name = decodeURIComponent(url.split(/[?#]/)[0]);
    const path = name.startsWith('/') ? resolve(root, '.' + name) : resolve(base, name);
    if (!path.startsWith(root + '/'))
      throw new Error('A standalone scene may only embed its own resources');
    return path;
  }
  async function data(url, base = root, parents = []) {
    url = url.trim();
    if (embedded(url)) return url;
    const file = local(url, base);
    if (parents.includes(file)) throw new Error(`Circular SVG resource: ${file}`);
    let bytes = await readFile(file);
    if (extname(file).toLowerCase() === '.svg')
      bytes = Buffer.from(await markup(bytes.toString('utf8'), dirname(file), [...parents, file]));
    const fragment = url.includes('#') ? url.slice(url.indexOf('#')) : '';
    return `data:${mediaType(file)};base64,${bytes.toString('base64')}${fragment}`;
  }
  async function css(source, base, parents) {
    if (!/(?:url\s*\(|@import\b)/i.test(source)) return source;
    const output = await build({
      stdin: { contents: source, loader: 'css', resolveDir: base, sourcefile: 'inline.css' },
      bundle: true,
      write: false,
      logLevel: 'silent',
      plugins: [
        {
          name: 'standalone-resources',
          setup(build) {
            build.onResolve({ filter: /.*/ }, async (args) => {
              if (args.kind === 'url-token')
                return {
                  path: await data(args.path, args.resolveDir || base, parents),
                  external: true,
                };
              if (embedded(args.path)) return { path: args.path, external: true };
              return { path: local(args.path, args.resolveDir || base) };
            });
          },
        },
      ],
    });
    return output.outputFiles[0].text;
  }
  async function markup(source, base = root, parents = []) {
    const document = parse(source, { sourceCodeLocationInfo: true });
    const edits = [];
    const replace = (location, value) => {
      if (location) edits.push({ start: location.startOffset, end: location.endOffset, value });
    };
    async function visit(node) {
      const name = node.tagName;
      const location = node.sourceCodeLocation;
      const attrs = Object.fromEntries((node.attrs ?? []).map((a) => [a.name, a.value]));
      if (name === 'base' && attrs.href)
        throw new Error('Remove <base href> before packing; resources must belong to the scene');
      if (name === 'use' && attrs.href && !attrs.href.startsWith('#'))
        throw new Error('Inline external SVG <use> symbols before packing; use href="#symbol"');
      if (name === 'link' && attrs.rel?.split(/\s+/).includes('stylesheet')) {
        const file = local(attrs.href, base);
        const content = await css(await readFile(file, 'utf8'), dirname(file), parents);
        replace(
          location,
          `<style${attrs.media ? ` media="${escape(attrs.media)}"` : ''}>${content}</style>`,
        );
        return;
      }
      if (name === 'style' && location?.endTag) {
        const start = location.startTag.endOffset,
          end = location.endTag.startOffset;
        const raw = source.slice(start, end);
        const cdata = /^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/.exec(raw);
        const content = await css(cdata ? cdata[1] : raw, base, parents);
        edits.push({ start, end, value: cdata ? `<![CDATA[${content}]]>` : content });
      }
      for (const attr of node.attrs ?? []) {
        const key = attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name;
        const span = location?.attrs?.[key];
        let value;
        if (attr.name === 'style') {
          const result = await css(`x{${attr.value}}`, base, parents);
          value = result.slice(result.indexOf('{') + 1, result.lastIndexOf('}'));
        } else if (
          (['img', 'source', 'video', 'embed'].includes(name) &&
            ['src', 'poster'].includes(attr.name)) ||
          (name === 'image' && attr.name === 'href') ||
          (name === 'link' && attr.name === 'href' && /icon/i.test(attrs.rel ?? ''))
        )
          value = await data(attr.value, base, parents);
        else if (['img', 'source'].includes(name) && attr.name === 'srcset')
          value = await srcset(attr.value, (url) => data(url, base, parents));
        else if (name === 'iframe' && attr.name === 'src' && !embedded(attr.value))
          throw new Error('Inline iframe content as srcdoc before packing');
        if (value !== undefined) replace(span, `${key}="${escape(value)}"`);
      }
      for (const child of node.childNodes ?? []) await visit(child);
      if (node.content) await visit(node.content);
    }
    await visit(document);
    for (const edit of edits.sort((a, b) => b.start - a.start))
      source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
    return source;
  }
  return { local, data, markup };
}
