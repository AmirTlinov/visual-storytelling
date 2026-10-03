import pencilURL from '../assets/pencil.woff2';
import fallbackURL from '../assets/shantell.woff2';
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
  'vector-effect',
  'stop-color',
  'stop-opacity',
  'flood-color',
  'flood-opacity',
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
  { name: 'SketchPencil', url: pencilURL },
  { name: 'SketchShantell', url: fallbackURL },
];

// CSS Color 4 is resolved by Chromium, but SVG renderers also need CSS 3 paint.
const paint = (value: string) =>
  value.replace(
    /color\(srgb ([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+)(?: \/ ([\d.e+-]+))?\)/g,
    (_, r: string, g: string, b: string, alpha: string | undefined) =>
      `rgba(${Number(r) * 100}%,${Number(g) * 100}%,${Number(b) * 100}%,${alpha ?? '1'})`,
  );

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
      copy.style.setProperty(property, paint(style.getPropertyValue(property)));
      copy.removeAttribute(property);
    }
    // SMIL values live in animVal, while cloneNode copies the original base geometry.
    for (const animation of node.querySelectorAll(':scope > animate,:scope > animateTransform')) {
      const attribute = animation.getAttribute('attributeName');
      if (!attribute) continue;
      if (attribute === 'transform' && 'transform' in node) {
        const transforms = (node as SVGGraphicsElement).transform.animVal;
        let matrix = new DOMMatrix();
        for (let j = 0; j < transforms.numberOfItems; j++)
          matrix = matrix.multiply(transforms.getItem(j).matrix);
        copy.setAttribute(
          'transform',
          `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`,
        );
      } else {
        const animated = Reflect.get(node, attribute) as
          | { animVal?: number | { value?: number } }
          | undefined;
        const value =
          typeof animated?.animVal === 'number' ? animated.animVal : animated?.animVal?.value;
        if (value !== undefined) copy.setAttribute(attribute, String(value));
      }
    }
    copy.removeAttribute('class');
  });
  clone
    .querySelectorAll('animate,animateTransform,animateMotion,set,script')
    .forEach((node) => node.remove());
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
  // Notebook paper may belong to the surrounding HTML shell. Preserve its scale
  // and origin when that shell is removed from the exported SVG.
  const paper = source.closest('.ve-scene');
  if (paper) {
    const style = getComputedStyle(paper);
    if (style.backgroundImage !== 'none') {
      const bounds = source.getBoundingClientRect(),
        origin = paper.getBoundingClientRect();
      const sx = viewBox.width / bounds.width,
        sy = viewBox.height / bounds.height;
      const size = style.backgroundSize.split(',')[0]!.trim().split(/\s+/).map(parseFloat);
      const position = style.backgroundPosition.split(',')[0]!.trim().split(/\s+/).map(parseFloat);
      const width = size[0]! * sx,
        height = (size[1] ?? size[0])! * sy;
      const x = viewBox.x + (origin.left - bounds.left + position[0]!) * sx;
      const y = viewBox.y + (origin.top - bounds.top + (position[1] ?? position[0])!) * sy;
      const probe = svg('rect', { width: 0, height: 0, fill: 'var(--ve-grid-ink)' });
      source.append(probe);
      const ink = paint(getComputedStyle(probe).fill);
      probe.remove();
      let id = 'export-paper';
      while (clone.querySelector(`#${id}`)) id += '-';
      const pattern = svg('pattern', { id, x, y, width, height, patternUnits: 'userSpaceOnUse' });
      pattern.append(
        svg('rect', { width: sx, height, fill: ink }),
        svg('rect', { width, height: sy, fill: ink }),
      );
      definitions.append(pattern);
      const background = svg('g', { 'aria-hidden': 'true' });
      const area = { x: viewBox.x, y: viewBox.y, width: viewBox.width, height: viewBox.height };
      background.append(
        svg('rect', { ...area, fill: paint(style.backgroundColor) }),
        svg('rect', { ...area, fill: `url(#${id})` }),
      );
      definitions.after(background);
    }
  }
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

import type { Theme } from '../ink/palette.js';
import type { CueReview } from '../story/cues.js';
export interface SceneHandle {
  duration: number;
  checkpoints: readonly number[];
  audioURL?: string;
  seek(time: number): void;
  pause(): void;
  setTheme(value: Theme): void;
  setReduced(value: boolean): void;
  svg(): SVGSVGElement;
  snapshot(): unknown;
  review?(): CueReview;
  exportSVG?(): Promise<string>;
  dispose(): void;
}
