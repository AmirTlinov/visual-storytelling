import type { MountedChapter } from './composition-presentations.js';
import { freezeObjectMeanings } from '../scene-objects.js';
import { snapshotCanvas } from '../export/raster.js';
let sequence = 0;

/** Keep accepted pixels and object meanings while boundary capture borrows the live drawing. */
export async function freezePresentation(
  {
    element,
    drawing,
  }: Pick<MountedChapter, 'element'> & { drawing: Pick<MountedChapter['drawing'], 'capture'> },
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (element.hidden || element.hasAttribute('data-presentation-pending')) return () => {};
  const image = await drawing.capture?.();
  signal.throwIfAborted();
  const frozen = element.cloneNode(true) as HTMLDivElement;
  const release = freezeObjectMeanings(element, frozen);
  const prefix = `ve-frozen-${++sequence}-`,
    ids = new Map<string, string>();
  for (const node of frozen.querySelectorAll('[id]')) ids.set(node.id, prefix + node.id);
  for (const node of [frozen, ...frozen.querySelectorAll('*')])
    for (const attribute of [...node.attributes]) {
      let value = attribute.value;
      if (attribute.name === 'id') value = ids.get(value) ?? value;
      else if (value.startsWith('#')) value = '#' + (ids.get(value.slice(1)) ?? value.slice(1));
      value = value.replace(/url\((['"]?)#([^)'"\s]+)\1\)/g, (match, quote, id) =>
        ids.has(id) ? `url(${quote}#${ids.get(id)}${quote})` : match,
      );
      if (value !== attribute.value) node.setAttribute(attribute.name, value);
    }
  delete frozen.dataset.chapter;
  delete frozen.dataset.presentationPending;
  frozen.dataset.presentationFrozen = '';
  frozen.inert = true;
  Object.assign(frozen.style, {
    position: 'absolute',
    inset: 'auto',
    left: `${element.offsetLeft}px`,
    top: `${element.offsetTop}px`,
    width: `${element.offsetWidth}px`,
    height: `${element.offsetHeight}px`,
    pointerEvents: 'none',
  });
  const canvases = [...element.querySelectorAll('canvas')];
  for (const [index, canvas] of frozen.querySelectorAll('canvas').entries()) {
    const source = canvases[index]!;
    await snapshotCanvas(source, canvas);
    signal.throwIfAborted();
  }
  if (image) {
    Object.assign(image.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    });
    frozen.append(image);
  }
  element.after(frozen);
  const clip = element.style.clipPath,
    pending = element.getAttribute('data-presentation-pending'),
    inert = element.inert;
  element.style.clipPath = 'inset(100%)';
  element.dataset.presentationPending = '';
  element.inert = true;
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    release();
    frozen.remove();
    if (clip) element.style.clipPath = clip;
    else element.style.removeProperty('clip-path');
    if (pending === null) delete element.dataset.presentationPending;
    else element.setAttribute('data-presentation-pending', pending);
    element.inert = inert;
  };
}
