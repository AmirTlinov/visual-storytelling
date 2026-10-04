export interface SceneFrameOptions {
  width: number;
  height: number;
}

/** Keep the complete logical composition inside the available aperture. */
export function fitFrame(
  width: number,
  height: number,
  availableWidth: number,
  availableHeight = Infinity,
) {
  const scale = Math.max(0, Math.min(availableWidth / width, availableHeight / height));
  return { width: width * scale, height: height * scale, scale };
}

/** A logical film canvas; the browser scales the complete composition as one unit. */
export function sceneFrame(stage: HTMLElement, { width, height }: SceneFrameOptions) {
  if (![width, height].every((n) => Number.isFinite(n) && n > 0))
    throw new Error('Scene frame dimensions must be positive');
  const element = document.createElement('div');
  element.className = 've-frame';
  element.dataset.sceneFrame = '';
  element.style.aspectRatio = `${width} / ${height}`;
  stage.classList.add('ve-frame-content');
  Object.assign(stage.style, {
    width: `${width}px`,
    height: `${height}px`,
    transformOrigin: '0 0',
  });
  element.append(stage);
  let root: HTMLElement | null = null;
  const resize = () => {
    if (!element.parentElement) return;
    if (root !== element.parentElement) {
      if (root) observer.unobserve(root);
      root = element.parentElement;
      observer.observe(root);
    }
    const style = getComputedStyle(root);
    const availableWidth =
      root.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (!availableWidth) return;
    let availableHeight = Infinity;
    if (root.closest('.ve-standalone')) {
      const box = root.getBoundingClientRect(),
        frame = element.getBoundingClientRect();
      const chrome = box.height - frame.height;
      const top = Math.max(0, box.top + scrollY);
      const body = getComputedStyle(document.body);
      const bottom = (parseFloat(body.marginBottom) || 0) + (parseFloat(body.paddingBottom) || 0);
      availableHeight = Math.max(1, innerHeight - top - chrome - bottom);
    }
    const fit = fitFrame(width, height, availableWidth, availableHeight);
    element.style.width = `${fit.width}px`;
    element.style.height = `${fit.height}px`;
    stage.style.transform = `scale(${fit.scale})`;
  };
  let pending = 0;
  const schedule = () => {
    if (!pending)
      pending = requestAnimationFrame(() => {
        pending = 0;
        resize();
      });
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(element);
  window.addEventListener('resize', resize);
  return {
    element,
    resize,
    dispose() {
      observer.disconnect();
      cancelAnimationFrame(pending);
      window.removeEventListener('resize', resize);
    },
  };
}

interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface InspectedObject extends Rectangle {
  id: string;
  visible?: boolean;
  data?: {
    framing?: 'background' | 'subject';
    /** Rendered screen pixels, after all viewport and camera transforms. */
    text?: { pixels: number; minimum?: number };
  };
}
export interface ScenePresentation {
  viewport: { width: number; height: number };
  frame: Rectangle;
  outsideViewport: boolean;
  clipped: { id: string; bounds: Rectangle; clip: Rectangle }[];
  uninspectedCanvases: number;
  unreadableText: { id: string; pixels: number; minimum: number }[];
}

/** Geometric evidence for review, computed on demand without another render loop. */
export function inspectPresentation(stage: HTMLElement | SVGSVGElement): ScenePresentation {
  const styles = new Map<Element, CSSStyleDeclaration>();
  const styleOf = (node: Element) => {
    if (!styles.has(node)) styles.set(node, getComputedStyle(node));
    return styles.get(node)!;
  };
  const visible = (node: Element) => {
    if (!node.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    // Chromium's checkVisibility currently returns true for SVG under display:none.
    const style = styleOf(node);
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    for (let parent: Element | null = node; parent; parent = parent.parentElement) {
      const parentStyle = styleOf(parent);
      if (parentStyle.display === 'none' || Number(parentStyle.opacity) === 0) return false;
    }
    return true;
  };
  const projected = new Map<Element, boolean>();
  const hasPerspective = (node: Element): boolean => {
    if (projected.has(node)) return projected.get(node)!;
    const style = styleOf(node);
    const own =
      (style.perspective && style.perspective !== 'none') ||
      (style.transform && style.transform !== 'none' && !new DOMMatrix(style.transform).is2D);
    const result = Boolean(own || (node.parentElement && hasPerspective(node.parentElement)));
    projected.set(node, result);
    return result;
  };
  const textPixels = (node: SVGGraphicsElement, size: number) => {
    const matrix = node.getScreenCTM();
    if (!matrix) return 0;
    if (!hasPerspective(node)) return size * Math.hypot(matrix.c, matrix.d);
    // getScreenCTM drops the projective denominator. Measure three transformed
    // vertical strokes in the same coordinate space; the smallest is the far edge.
    const box = node.getBBox(),
      group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const style = styleOf(node);
    group.style.transform = style.transform;
    group.style.transformOrigin = style.transformOrigin;
    group.style.visibility = 'hidden';
    group.setAttribute('aria-hidden', 'true');
    for (const x of [box.x, box.x + box.width / 2, box.x + box.width]) {
      const line = document.createElementNS(group.namespaceURI, 'line');
      line.setAttribute('x1', String(x));
      line.setAttribute('x2', String(x));
      line.setAttribute('y1', String(box.y + (box.height - size) / 2));
      line.setAttribute('y2', String(box.y + (box.height + size) / 2));
      group.append(line);
    }
    node.parentElement!.append(group);
    try {
      return Math.min(
        ...[...group.children].map((line) => {
          const { width, height } = line.getBoundingClientRect();
          return Math.hypot(width, height);
        }),
      );
    } finally {
      group.remove();
    }
  };
  const rectangle = (box: Rectangle): Rectangle => ({
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  });
  const frame = rectangle((stage.closest('.ve-frame') ?? stage).getBoundingClientRect());
  const result: ScenePresentation = {
    viewport: { width: innerWidth, height: innerHeight },
    frame,
    outsideViewport: false,
    clipped: [],
    uninspectedCanvases: 0,
    unreadableText: [],
  };
  const outside = (a: Rectangle, b: Rectangle) =>
    a.x < b.x - 1 ||
    a.y < b.y - 1 ||
    a.x + a.width > b.x + b.width + 1 ||
    a.y + a.height > b.y + b.height + 1;
  if (!visible(stage)) return result;
  result.outsideViewport = outside(frame, { x: 0, y: 0, width: innerWidth, height: innerHeight });
  const inspect = (node: Element, object: InspectedObject, canvas = false) => {
    if (
      object.visible === false ||
      object.data?.framing === 'background' ||
      ![object.x, object.y, object.width, object.height].every(Number.isFinite)
    )
      return;
    const text = object.data?.text;
    if (text && Number.isFinite(text.pixels) && text.pixels < (text.minimum ?? 14) - 0.1)
      result.unreadableText.push({
        id: object.id,
        pixels: text.pixels,
        minimum: text.minimum ?? 14,
      });
    let clip = { ...frame };
    for (
      let ancestor: Element | null = canvas ? node : node.parentElement;
      ancestor && ancestor !== stage.parentElement;
      ancestor = ancestor.parentElement
    ) {
      const style = styleOf(ancestor),
        box = ancestor.getBoundingClientRect();
      const clips = (axis: string) =>
        (canvas && ancestor === node) || ['hidden', 'clip', 'scroll', 'auto'].includes(axis);
      if (clips(style.overflowX)) {
        const right = Math.min(clip.x + clip.width, box.right);
        clip.x = Math.max(clip.x, box.x);
        clip.width = right - clip.x;
      }
      if (clips(style.overflowY)) {
        const bottom = Math.min(clip.y + clip.height, box.bottom);
        clip.y = Math.max(clip.y, box.y);
        clip.height = bottom - clip.y;
      }
    }
    if (outside(object, clip))
      result.clipped.push({ id: object.id, bounds: rectangle(object), clip });
  };
  const nodes = stage.querySelectorAll<HTMLElement | SVGElement>(
    '[data-review-id], [data-camera-world], svg text, [data-lettering-size], canvas',
  );
  for (const [index, node] of [...nodes].entries()) {
    if (!visible(node) || node.closest('[data-review-framing="background"]')) continue;
    const id = node.dataset.reviewId || node.id || `${node.localName}:${index}`;
    let text: InspectedObject['data'];
    if ((node.localName === 'text' || node.dataset.letteringSize) && 'getScreenCTM' in node) {
      text = {
        text: {
          pixels: textPixels(
            node as SVGGraphicsElement,
            Number(node.dataset.letteringSize) || parseFloat(styleOf(node).fontSize),
          ),
          minimum: Number(node.dataset.minimumFontSize) || 14,
        },
      };
    }
    inspect(node, { id, ...rectangle(node.getBoundingClientRect()), data: text });
    if (node instanceof HTMLCanvasElement) {
      const inspection = (
        node as HTMLCanvasElement & { __visualReview?: () => { objects?: InspectedObject[] } }
      ).__visualReview?.();
      if (!inspection) result.uninspectedCanvases++;
      for (const object of inspection?.objects ?? []) inspect(node, object, true);
    }
  }
  return result;
}
