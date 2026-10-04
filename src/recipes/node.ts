import { object } from '../ink/object.js';
import { lettering } from '../ink/lettering.js';
import { roundedRect } from '../ink/pen.js';
import type { Pigment } from '../ink/palette.js';
import type { Surface } from '../ink/surface.js';

export interface NodeOptions {
  parent?: SVGElement;
  shape?: 'rect' | 'ellipse';
  width?: number;
  height?: number;
  size?: number;
  minSize?: number;
  padding?: number;
  pigment?: Pigment;
  format?: (value: number) => string;
}

/** A bounded inscription and its body share one identity. Long labels grow the body at minSize. */
export function node(
  view: Surface,
  id: string,
  initial: string | number,
  options: NodeOptions = {},
) {
  const width = options.width ?? 64;
  const height = options.height ?? width;
  const padding = options.padding ?? 6;
  const size = options.size ?? 30;
  const minSize = options.minSize ?? 16;
  if (
    ![width, height, padding, size, minSize].every(Number.isFinite) ||
    padding < 0 ||
    width <= padding * 2 ||
    height <= padding * 2 ||
    size <= 0 ||
    minSize <= 0
  )
    throw new Error('Node dimensions and text sizes must be positive, with space inside padding');
  const kind = options.shape ?? 'ellipse';
  const mark = object(options.parent ?? view.layer, id, options.pigment ?? 'blue');
  const body =
    kind === 'ellipse'
      ? view.pen.ellipse(mark.content, `${id}:shape`, 0, 0, width / 2, height / 2, {
          fill: 'marker',
        })
      : view.pen.rect(mark.content, `${id}:shape`, -width / 2, -height / 2, width, height, {
          fill: 'marker',
        });
  const format = options.format ?? String;
  const label = lettering(mark.content, typeof initial === 'number' ? format(initial) : initial, {
    size,
    minSize,
    tabular: true,
    bounds: { width, height, shape: kind, padding },
  });
  let bodyWidth = width,
    bodyHeight = height;
  const fit = () => {
    const ink = label.bounds;
    const rx = ink.width / (width - padding * 2),
      ry = ink.height / (height - padding * 2);
    const growthX = kind === 'ellipse' ? Math.hypot(rx, ry) : rx;
    const growthY = kind === 'ellipse' ? growthX : ry;
    // A fitted ellipse can exceed unity by a few ulps after measuring its scaled ink.
    // Retain the exact authored dimensions instead of rebuilding its contour for that noise.
    const nextWidth =
      growthX <= 1 + Number.EPSILON * 8 ? width : (width - padding * 2) * growthX + padding * 2;
    const nextHeight =
      growthY <= 1 + Number.EPSILON * 8 ? height : (height - padding * 2) * growthY + padding * 2;
    if (nextWidth !== bodyWidth || nextHeight !== bodyHeight) {
      bodyWidth = nextWidth;
      bodyHeight = nextHeight;
      const rx = bodyWidth / 2,
        ry = bodyHeight / 2;
      body.update(
        kind === 'ellipse'
          ? `M${-rx} 0 A${rx} ${ry} 0 1 0 ${rx} 0 A${rx} ${ry} 0 1 0 ${-rx} 0 Z`
          : roundedRect(-rx, -ry, bodyWidth, bodyHeight),
        { x: -rx, y: -ry, width: bodyWidth, height: bodyHeight },
      );
    }
    delete label.element.dataset.layoutError;
  };
  fit();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unregister();
    label.dispose();
    body.dispose();
    mark.dispose();
  };
  const unregister = view.onDispose(dispose);
  const text = (next: string) => {
    label.text(next);
    fit();
  };
  return {
    ...mark,
    label,
    /** Only the body participates in SvgLayout.connect; captions cannot shift its endpoints. */
    shape: body.element,
    text,
    value(next: number) {
      text(format(next));
    },
    get width() {
      return bodyWidth;
    },
    get height() {
      return bodyHeight;
    },
    /** Named attachment points in surface.layer coordinates, including placement and motion. */
    get anchors() {
      const matrix = view.layer.getCTM()!.inverse().multiply(mark.content.getCTM()!);
      const point = (x: number, y: number) => {
        const p = new DOMPoint(x, y).matrixTransform(matrix);
        return { x: p.x, y: p.y };
      };
      return {
        center: point(0, 0),
        top: point(0, -bodyHeight / 2),
        right: point(bodyWidth / 2, 0),
        bottom: point(0, bodyHeight / 2),
        left: point(-bodyWidth / 2, 0),
      };
    },
    reveal(progress: number) {
      body.reveal(progress);
      label.write(progress);
    },
    dispose,
  };
}
