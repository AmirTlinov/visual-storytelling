import { cp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';

/** Embedded SVG cannot inherit custom properties from its CSS image host.
 * Resolve its paint from the canonical palette while retaining the image's
 * inherited colour-scheme and the authored paths. */
export function materializePaletteSVG(css, palette) {
  return css.replace(/url\("data:image\/svg\+xml,([^"\n]+)"\)/g, (url, encoded) => {
    const svg = decodeURIComponent(encoded);
    if (!svg.includes('var(--ve-')) return url;
    const painted = svg.replace(/<style>([\s\S]*?)<\/style>/g, (_, style) => {
      const paint = (theme) =>
        style.replace(/var\((--ve-[a-z-]+)\)/g, (_, name) => {
          const values = palette.match(
            new RegExp(`${name}:\\s*light-dark\\((#[\\da-f]+),\\s*(#[\\da-f]+)\\)`, 'i'),
          );
          if (!values) throw new Error(`SVG paint needs a light-dark pigment in ink.css: ${name}`);
          return values[theme === 'light' ? 1 : 2];
        });
      return `<style>${paint('light')}@media(prefers-color-scheme:dark){${paint('dark')}}</style>`;
    });
    if (painted.includes('var(--ve-')) throw new Error('SVG pigment references must be in <style>');
    return `url("data:image/svg+xml,${encodeURIComponent(painted)}")`;
  });
}

/** All packaged styles, including direct CSS imports, receive the same images. */
export async function buildStyles(source, output) {
  await cp(source, output, { recursive: true });
  let palette;
  for (const name of await readdir(output, { recursive: true })) {
    if (!name.endsWith('.css')) continue;
    const file = join(output, name);
    const css = await readFile(file, 'utf8');
    // Leave ordinary CSS and monochrome masks byte-for-byte intact.
    if (!/data:image\/svg\+xml,[^"\n]*var\(--ve-/.test(css)) continue;
    palette ??= await readFile(join(source, 'ink.css'), 'utf8');
    await writeFile(file, materializePaletteSVG(css, palette));
  }
}

/** Source-alias gallery/dev builds use the same paint compilation as dist. */
export function sourcePaletteImages(source) {
  return {
    name: 'source-palette-images',
    setup(build) {
      build.onLoad({ filter: /\.css$/ }, async ({ path }) => {
        if (!path.startsWith(source + sep)) return;
        const css = await readFile(path, 'utf8');
        if (!/data:image\/svg\+xml,[^"\n]*var\(--ve-/.test(css)) return;
        return {
          contents: materializePaletteSVG(css, await readFile(join(source, 'ink.css'), 'utf8')),
          loader: 'css',
        };
      });
    },
  };
}
