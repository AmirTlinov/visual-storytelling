import { svg } from '../ink/dom.js';

// CSS Color 4 is resolved by Chromium, but SVG renderers also need CSS 3 paint.
export const paint = (value: string) =>
  value.replace(
    /color\(srgb ([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+)(?: \/ ([\d.e+-]+))?\)/g,
    (_, r: string, g: string, b: string, alpha: string | undefined) =>
      `rgba(${Number(r) * 100}%,${Number(g) * 100}%,${Number(b) * 100}%,${alpha ?? '1'})`,
  );

/** Freeze the existing paper material in the coordinate system of the exported drawing. */
export function appendPaper(
  target: SVGSVGElement,
  definitions: SVGDefsElement,
  owner: HTMLElement,
  view: { x: number; y: number; width: number; height: number },
  bounds: DOMRect,
  opaque = false,
) {
  const style = getComputedStyle(owner);
  const background = svg('g', { 'aria-hidden': 'true', 'data-export-paper': '' });
  const area = { x: view.x, y: view.y, width: view.width, height: view.height };
  let color = style.backgroundColor;
  if (opaque && (color === 'transparent' || /[,/]\s*0\s*\)$/.test(color))) {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--ve-surface, Canvas)';
    owner.append(probe);
    color = getComputedStyle(probe).color;
    probe.remove();
  }
  background.append(svg('rect', { ...area, fill: paint(color) }));
  if (style.backgroundImage !== 'none') {
    const origin = owner.getBoundingClientRect();
    const sx = view.width / bounds.width,
      sy = view.height / bounds.height;
    const paperScaleX = origin.width / (owner.offsetWidth || origin.width);
    const paperScaleY = origin.height / (owner.offsetHeight || origin.height);
    const sizes = style.backgroundSize
      .split(',')
      .map((size) => size.trim().split(/\s+/).map(parseFloat));
    const major = sizes[0]!,
      minor = sizes[2]!;
    if (!minor || ![...major, ...minor].every((value) => Number.isFinite(value) && value > 0))
      throw new Error('SVG paper needs the shared notebook grid');
    const position = style.backgroundPosition.split(',')[0]!.trim().split(/\s+/).map(parseFloat);
    const width = major[0]! * paperScaleX * sx;
    const height = (major[1] ?? major[0])! * paperScaleY * sy;
    const x = view.x + (origin.left - bounds.left + position[0]! * paperScaleX) * sx;
    const y = view.y + (origin.top - bounds.top + (position[1] ?? position[0])! * paperScaleY) * sy;
    const probe = document.createElement('span');
    Object.assign(probe.style, {
      position: 'absolute',
      visibility: 'hidden',
      height: 'var(--ve-grid-line, 1px)',
    });
    owner.append(probe);
    const ink = (variable: string) => {
      probe.style.color = `var(${variable})`;
      return paint(getComputedStyle(probe).color);
    };
    let minorInk: string, majorInk: string, line: number;
    try {
      minorInk = ink('--ve-grid-ink');
      majorInk = ink('--ve-grid-major-ink');
      line = parseFloat(getComputedStyle(probe).height) || 1;
    } finally {
      probe.remove();
    }
    let id = 'export-paper';
    while (target.querySelector(`#${id}`)) id += '-';
    const pattern = svg('pattern', { id, x, y, width, height, patternUnits: 'userSpaceOnUse' });
    for (let column = 0; column < width - 0.01; column += minor[0]! * paperScaleX * sx)
      pattern.append(
        svg('rect', { x: column, width: line * sx * paperScaleX, height, fill: minorInk }),
      );
    for (let row = 0; row < height - 0.01; row += minor[1]! * paperScaleY * sy)
      pattern.append(
        svg('rect', { y: row, width, height: line * sy * paperScaleY, fill: minorInk }),
      );
    pattern.append(
      svg('rect', { width: line * sx * paperScaleX, height, fill: majorInk }),
      svg('rect', { width, height: line * sy * paperScaleY, fill: majorInk }),
    );
    definitions.append(pattern);
    background.append(svg('rect', { ...area, fill: `url(#${id})` }));
  }
  definitions.after(background);
}
