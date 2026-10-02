import { svg } from '../ink/dom.js';

const properties = [
  'color',
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'opacity',
  'visibility',
  'display',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'paint-order',
] as const;
const fonts = [
  { name: 'Notebook', url: new URL('../assets/pencil.woff2', import.meta.url).href },
  { name: 'NotebookFallback', url: new URL('../assets/shantell.woff2', import.meta.url).href },
];

/** Resolve the current theme and bundle the font; exported SVG has no runtime dependency. */
export async function exportSVG(source: SVGSVGElement): Promise<string> {
  await document.fonts.ready;
  const clone = source.cloneNode(true) as SVGSVGElement;
  const originals = [source, ...source.querySelectorAll<SVGElement>('*')];
  const copies = [clone, ...clone.querySelectorAll<SVGElement>('*')];
  originals.forEach((node, i) => {
    const style = getComputedStyle(node),
      copy = copies[i]!;
    for (const property of properties) {
      copy.style.setProperty(property, style.getPropertyValue(property));
      copy.removeAttribute(property);
    }
    copy.removeAttribute('class');
  });
  const definitions = svg('defs');
  for (const font of fonts) {
    const response = await fetch(font.url);
    if (!response.ok) throw new Error('Could not bundle lettering font');
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    definitions.append(
      svg(
        'style',
        {},
        `@font-face{font-family:${font.name};src:url(data:font/woff2;base64,${btoa(binary)}) format('woff2')}`,
      ),
    );
  }
  clone.prepend(definitions);
  const viewBox = source.viewBox.baseVal;
  clone.setAttribute('width', String(viewBox.width));
  clone.setAttribute('height', String(viewBox.height));
  clone.style.width = `${viewBox.width}px`;
  clone.style.height = `${viewBox.height}px`;
  return new XMLSerializer().serializeToString(clone);
}
export function download(content: string | Blob, name: string, type = 'image/svg+xml') {
  const url = URL.createObjectURL(
    typeof content === 'string' ? new Blob([content], { type }) : content,
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
