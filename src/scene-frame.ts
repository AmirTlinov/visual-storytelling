export interface SceneFrameOptions {
  width: number;
  height: number;
  /** Frame the subject only, or the complete lesson including its controls. */
  scope?: 'stage' | 'scene';
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

/** Fit an authored canvas as one unit. Append element, call resize(), and release it with its owning scene. */
export function sceneFrame(
  content: HTMLElement,
  { width, height, scope = 'stage' }: SceneFrameOptions,
) {
  if (![width, height].every((n) => Number.isFinite(n) && n > 0))
    throw new Error('Scene frame dimensions must be positive');
  const element = document.createElement('div');
  element.className = scope === 'scene' ? 've-scene-frame' : 've-frame';
  element.dataset.sceneFrame = '';
  element.dataset.frameScope = scope;
  element.style.aspectRatio = `${width} / ${height}`;
  content.classList.add(scope === 'scene' ? 've-scene-content' : 've-frame-content');
  Object.assign(content.style, {
    width: `${width}px`,
    height: `${height}px`,
    transformOrigin: '0 0',
  });
  element.append(content);
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
    if (root.closest('[data-scene-frame]')) {
      availableHeight =
        root.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    } else if (root.closest('.ve-standalone')) {
      const box = root.getBoundingClientRect();
      const chrome =
        scope === 'scene'
          ? (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
          : box.height - element.getBoundingClientRect().height;
      const top = Math.max(0, box.top + scrollY);
      const body = getComputedStyle(document.body);
      const bottom = (parseFloat(body.marginBottom) || 0) + (parseFloat(body.paddingBottom) || 0);
      availableHeight = Math.max(1, innerHeight - top - chrome - bottom);
    }
    const fit = fitFrame(width, height, availableWidth, availableHeight);
    const changed = element.dataset.frameScale !== String(fit.scale);
    element.dataset.frameLayout = 'fixed';
    element.style.width = `${fit.width}px`;
    element.style.height = `${fit.height}px`;
    content.style.transform = `scale(${fit.scale})`;
    element.dataset.frameScale = String(fit.scale);
    if (changed) element.dispatchEvent(new CustomEvent('scene-frame-resize', { bubbles: true }));
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
  /** Full labels exposed by the surface's overflow action instead of overlapping the drawing. */
  layoutOverflow: { id: string; text: string }[];
}

/** Shared by visual review and semantic inspection, including Chromium's hidden SVG case. */
export function isRendered(
  node: Element,
  styleOf: (node: Element) => CSSStyleDeclaration = getComputedStyle,
) {
  if (!node.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
  const style = styleOf(node);
  if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  for (let parent: Element | null = node; parent; parent = parent.parentElement) {
    const parentStyle = styleOf(parent);
    if (parentStyle.display === 'none' || Number(parentStyle.opacity) === 0) return false;
  }
  return true;
}

/** Geometric evidence for review, computed on demand without another render loop. */
export function inspectPresentation(stage: HTMLElement | SVGSVGElement): ScenePresentation {
  const styles = new Map<Element, CSSStyleDeclaration>();
  const styleOf = (node: Element) => {
    if (!styles.has(node)) styles.set(node, getComputedStyle(node));
    return styles.get(node)!;
  };
  const visible = (node: Element) => isRendered(node, styleOf);
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
  const framed = stage.closest<HTMLElement>('[data-scene-frame]');
  const subject = framed?.dataset.frameScope === 'scene' ? framed : stage;
  const frame = rectangle((framed ?? stage).getBoundingClientRect());
  const result: ScenePresentation = {
    viewport: { width: innerWidth, height: innerHeight },
    frame,
    outsideViewport: false,
    clipped: [],
    uninspectedCanvases: 0,
    unreadableText: [],
    layoutOverflow: [],
  };
  const outside = (a: Rectangle, b: Rectangle) =>
    a.x < b.x - 1 ||
    a.y < b.y - 1 ||
    a.x + a.width > b.x + b.width + 1 ||
    a.y + a.height > b.y + b.height + 1;
  if (!visible(stage)) return result;
  for (const [index, node] of [
    ...subject.querySelectorAll('[data-layout-status="overflow"]'),
  ].entries()) {
    let active = Number(styleOf(node).opacity) > 0;
    for (
      let parent = node.parentElement;
      active && parent && parent !== subject.parentElement;
      parent = parent.parentElement
    ) {
      const style = styleOf(parent);
      active =
        style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
    }
    if (active)
      result.layoutOverflow.push({
        id:
          node.closest('[data-object]')?.getAttribute('data-object') || node.id || `label:${index}`,
        text: node.getAttribute('aria-label') || node.textContent || '',
      });
  }
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
      ancestor && ancestor !== subject.parentElement;
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
  const nodes = subject.querySelectorAll<HTMLElement | SVGElement>(
    '[data-review-id], [data-camera-world], svg text, [data-lettering-size], canvas' +
      (subject === framed
        ? ', .ve-heading, .ve-chapter-navigation, .modes, .ve-parameters, [data-player], .ve-captions, .ve-select-list:popover-open'
        : ''),
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
