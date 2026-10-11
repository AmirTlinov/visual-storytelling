import { contourGeometry, type Point } from '../ink/pen.js';

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A measured, stable pen stroke stays inside the SVG subject's existing bounds. */
export function svgInteractionContour(target: SVGGraphicsElement, id: string) {
  const namespace = 'http://www.w3.org/2000/svg';
  const element = target.ownerDocument.createElementNS(namespace, 'g');
  element.setAttribute('data-interaction-contour', '');
  element.setAttribute('aria-hidden', 'true');
  element.setAttribute('pointer-events', 'none');
  const selection = target.ownerDocument.createElementNS(namespace, 'path');
  selection.setAttribute('data-selection-contour', '');
  const focus = target.ownerDocument.createElementNS(namespace, 'path');
  focus.setAttribute('data-interaction-focus', '');
  for (const path of [selection, focus]) {
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
  }
  element.append(selection, focus);
  target.after(element);
  const attribute = (node: Element, name: string, value: string) => {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  };
  return {
    element,
    update(bounds: Bounds = target.getBBox()) {
      const inset = Math.min(2.5, bounds.width / 4, bounds.height / 4),
        x = bounds.x + inset,
        y = bounds.y + inset,
        width = bounds.width - inset * 2,
        height = bounds.height - inset * 2,
        radius = Math.min(5, width / 2, height / 2);
      if (!(width > 0 && height > 0)) return;
      const points: Point[] = [];
      for (const [cx, cy, start] of [
        [x + width - radius, y + radius, -Math.PI / 2],
        [x + width - radius, y + height - radius, 0],
        [x + radius, y + height - radius, Math.PI / 2],
        [x + radius, y + radius, Math.PI],
      ])
        for (let step = 0; step <= 8; step++) {
          const angle = start! + (Math.PI * step) / 16;
          points.push([cx! + radius * Math.cos(angle), cy! + radius * Math.sin(angle)]);
        }
      const outline = contourGeometry(points, id, 1.35).outline;
      for (const path of [selection, focus]) attribute(path, 'd', outline);
      const style = getComputedStyle(target);
      const color =
        target.style.color ||
        target.getAttribute('color') ||
        (target.parentElement && style.color === getComputedStyle(target.parentElement).color
          ? 'inherit'
          : style.color);
      for (const property of [
        'color',
        'transform',
        'transform-origin',
        'translate',
        'rotate',
        'scale',
        'opacity',
      ] as const) {
        const value = property === 'color' ? color : style.getPropertyValue(property);
        if (element.style.getPropertyValue(property) !== value)
          element.style.setProperty(property, value);
      }
    },
    selected(active: boolean) {
      element.toggleAttribute('data-contour-selected', active);
    },
    dispose() {
      element.remove();
    },
  };
}
