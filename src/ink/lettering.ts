import { measureText } from './text-measure.js';
import { svg } from './dom.js';
import { SketchMotion } from './motion.js';
import { glyphs } from './glyphs.js';
export interface LetteringOptions {
  x?: number;
  y?: number;
  size?: number;
  anchor?: 'start' | 'middle' | 'end';
  tabular?: boolean;
  /** Fit the complete value without crossing the minimum readable size. */
  maxWidth?: number;
  minSize?: number;
  /** Center the complete ink inside this shape, including its padding. x/y become its center. */
  bounds?: { width: number; height: number; shape?: 'rect' | 'ellipse'; padding?: number };
}

type InkBounds = { x: number; y: number; width: number; height: number };

/** Read the existing pen geometry, including its moving tip, without relying on font advances. */
function inkBounds(label: SVGTextElement, content: SVGGElement): InkBounds {
  const ink = label.nextElementSibling;
  if (!ink?.hasAttribute('data-written-text'))
    return measureText(label, (text) => {
      const { x, y, width, height } = text.getBBox();
      return { x, y, width, height };
    });
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const path of ink.querySelectorAll('path')) {
    const box = path.getBBox();
    const tip = path.nextElementSibling;
    const padding = Math.max(
      Number(path.getAttribute('stroke-width')) / 2,
      tip?.tagName === 'circle' ? Number(tip.getAttribute('r')) : 0,
    );
    let matrix = new DOMMatrix();
    for (
      let node: SVGElement | null = path;
      node && node !== content;
      node = node.parentElement as SVGElement | null
    ) {
      if (node instanceof SVGGraphicsElement) {
        const transform = node.transform.baseVal.consolidate()?.matrix;
        if (transform) matrix = DOMMatrix.fromMatrix(transform).multiply(matrix);
      }
    }
    for (const x of [box.x - padding, box.x + box.width + padding])
      for (const y of [box.y - padding, box.y + box.height + padding]) {
        const point = new DOMPoint(x, y).matrixTransform(matrix);
        left = Math.min(left, point.x);
        top = Math.min(top, point.y);
        right = Math.max(right, point.x);
        bottom = Math.max(bottom, point.y);
      }
  }
  return Number.isFinite(left)
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : { x: 0, y: 0, width: 0, height: 0 };
}

/** A label owns its text and pen strokes together; the pen geometry has one implementation. */
export function lettering(
  parent: SVGElement,
  initial: string | number,
  options: LetteringOptions = {},
) {
  const bounds = options.bounds;
  const padding = bounds?.padding ?? 0;
  const nominalSize = options.size ?? 24;
  const minSize = options.minSize ?? 16;
  if (
    bounds &&
    (![bounds.width, bounds.height, padding, nominalSize, minSize].every(Number.isFinite) ||
      padding < 0 ||
      nominalSize <= 0 ||
      minSize <= 0 ||
      bounds.width <= padding * 2 ||
      bounds.height <= padding * 2)
  )
    throw new Error('Lettering bounds must have positive space inside their padding');
  const element = svg('g', { class: 'vs-lettering', role: 'img' });
  parent.append(element);
  const content = bounds ? svg('g') : element;
  if (content !== element) element.append(content);
  const label = svg('text', {
    'font-size': options.size ?? 24,
    'font-family': 'SketchPencil,SketchShantell,sans-serif',
    fill: 'currentColor',
  });
  label.style.whiteSpace = 'pre';
  if (options.tabular) label.style.fontVariantNumeric = 'tabular-nums';
  content.append(label);
  let value = '',
    width = 0,
    progress = 1,
    written = false,
    scale = 1,
    x = 0,
    y = 0;
  let measured: InkBounds | undefined;
  const position = () => {
    x =
      (options.x ?? 0) -
      (bounds
        ? scale * (measured!.x + measured!.width / 2)
        : options.anchor === 'start'
          ? 0
          : options.anchor === 'end'
            ? width
            : width / 2);
    y = (options.y ?? 0) - (bounds ? scale * (measured!.y + measured!.height / 2) : 0);
    const transform = `translate(${x} ${y})`;
    if (element.getAttribute('transform') !== transform)
      element.setAttribute('transform', transform);
  };
  const write = (amount: number) => {
    if (written && amount === progress) return;
    progress = amount;
    if ([...value].every((c) => /\s/.test(c) || glyphs[c])) {
      SketchMotion.write(label, amount);
      // The native text remains the measurement reference, while public getBBox()
      // describes the rendered strokes used by layout and connection avoidance.
      label.style.display = 'none';
    } else label.style.opacity = amount >= 1 ? '1' : '0';
    element.style.visibility = amount > 0 ? '' : 'hidden';
    written = true;
  };
  const text = (next: string | number) => {
    if (String(next) === value && element.hasAttribute('aria-label')) return;
    SketchMotion.resetText(label);
    label.style.removeProperty('opacity');
    label.style.removeProperty('display');
    written = false;
    measured = undefined;
    // Measure at the nominal scale: SVG glyph metrics otherwise inherit pixel rounding
    // from the preceding value's fit and drift when a value is revisited.
    if (bounds) content.removeAttribute('transform');
    value = String(next);
    label.textContent = value;
    element.setAttribute('aria-label', value);
    label.setAttribute('font-size', String(nominalSize));
    if (!bounds && options.maxWidth !== undefined) {
      const natural = measureText(label, (text) => text.getComputedTextLength());
      const size = Math.max(
        Math.min(nominalSize, minSize),
        Math.min(nominalSize, (nominalSize * options.maxWidth) / (natural || 1)),
      );
      label.setAttribute('font-size', String(size));
      if (measureText(label, (text) => text.getComputedTextLength()) > options.maxWidth + 0.5)
        element.dataset.layoutError = `Label "${value}" needs more than ${options.maxWidth}px at ${size}px. Enlarge its cell or show fewer items.`;
      else delete element.dataset.layoutError;
    }
    width = measureText(label, (text) => text.getComputedTextLength());
    write(progress);
    if (bounds) {
      measured = inkBounds(label, content);
      const rx = measured.width / (bounds.width - padding * 2);
      const ry = measured.height / (bounds.height - padding * 2);
      const ratio = bounds.shape === 'ellipse' ? Math.hypot(rx, ry) : Math.max(rx, ry);
      scale = Math.max(Math.min(1, minSize / nominalSize), Math.min(1, 1 / (ratio || 1)));
      content.setAttribute('transform', `scale(${scale})`);
      width *= scale;
      if (ratio * scale > 1 + 1e-6)
        element.dataset.layoutError = `Label "${value}" needs a larger ${bounds.shape ?? 'rect'} at ${nominalSize * scale}px.`;
      else delete element.dataset.layoutError;
    }
    position();
  };
  text(initial);
  return {
    element,
    text,
    write,
    get width() {
      return width;
    },
    /** Full ink bounds in the parent's coordinates, independent of writing progress. */
    get bounds(): InkBounds {
      measured ??= inkBounds(label, content);
      return {
        x: x + measured.x * scale,
        y: y + measured.y * scale,
        width: measured.width * scale,
        height: measured.height * scale,
      };
    },
    at(x: number, y: number) {
      options.x = x;
      options.y = y;
      position();
    },
    dispose() {
      SketchMotion.resetText(label);
      element.remove();
    },
  };
}
export type Lettering = ReturnType<typeof lettering>;
