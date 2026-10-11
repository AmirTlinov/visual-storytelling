import { svg } from '../ink/dom.js';
import { snapshotRaster } from './raster.js';
import { appendPaper, paint } from './paper.js';

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
  'font-style',
  'font-stretch',
  'font-variant-numeric',
  'letter-spacing',
  'word-spacing',
  'text-anchor',
  'paint-order',
  'transform',
  'transform-origin',
  'transform-box',
  'translate',
  'rotate',
  'scale',
  'outline-color',
  'outline-width',
  'outline-style',
  'outline-offset',
] as const;

/** Resolve the current theme and bundle the font; exported SVG has no runtime dependency. */
export async function exportSVG(
  source: SVGSVGElement,
  { paper = true }: { paper?: boolean } = {},
): Promise<string> {
  const fonts = [
    { name: 'SketchPencil', url: new URL('../assets/pencil.woff2', import.meta.url).href },
    {
      name: 'SketchPencilHeading',
      url: new URL('../assets/pencil-heading.woff2', import.meta.url).href,
    },
    { name: 'SketchPencilNote', url: new URL('../assets/pencil-note.woff2', import.meta.url).href },
    { name: 'SketchShantell', url: new URL('../assets/shantell.woff2', import.meta.url).href },
  ];
  const clone = source.cloneNode(true) as SVGSVGElement;
  const originals = [source, ...source.querySelectorAll<SVGElement>('*')];
  const copies = [clone, ...clone.querySelectorAll<SVGElement>('*')];
  originals.forEach((node, i) => {
    const style = getComputedStyle(node),
      copy = copies[i]!;
    for (const property of properties) {
      copy.style.setProperty(property, paint(style.getPropertyValue(property)));
      // SVG text.rotate and filter scale are attributes independent of CSS motion longhands.
      if (!['rotate', 'translate', 'scale'].includes(property)) copy.removeAttribute(property);
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
  originals.forEach((node, i) => snapshotRaster(node, copies[i]!));
  clone
    .querySelectorAll('animate,animateTransform,animateMotion,set,script,[data-interaction-focus]')
    .forEach((node) => node.remove());
  const definitions = svg('defs');
  clone.prepend(definitions);
  const viewBox = source.viewBox.baseVal;
  clone.setAttribute('width', String(viewBox.width));
  clone.setAttribute('height', String(viewBox.height));
  const backgroundOwner = paper
    ? source.closest<HTMLElement>(
        '.ve-frame-content, .ve-scene-paper, .ve-scene-content, .ve-scene',
      )
    : null;
  if (backgroundOwner)
    appendPaper(clone, definitions, backgroundOwner, viewBox, source.getBoundingClientRect());
  clone.style.width = `${viewBox.width}px`;
  clone.style.height = `${viewBox.height}px`;
  // Freeze geometry, raster layers and computed style before waiting for font bytes.
  // A caller may render the next frame as soon as this function returns its promise.
  await document.fonts.ready;
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
  return new XMLSerializer().serializeToString(clone);
}

/** Capture the current SVG frame atomically, then decode its self-contained image asynchronously. */
export async function snapshotSVG(source: SVGSVGElement, scale = 2): Promise<HTMLCanvasElement> {
  const { width, height } = source.viewBox.baseVal;
  if (![width, height, scale].every((value) => Number.isFinite(value) && value > 0))
    throw new Error('SVG capture needs a positive viewBox and scale');
  const serialized = exportSVG(source);
  const image = new Image(),
    url = URL.createObjectURL(new Blob([await serialized], { type: 'image/svg+xml' }));
  try {
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
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
