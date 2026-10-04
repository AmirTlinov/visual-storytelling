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
interface InspectedObject extends Rectangle {
  id: string;
  visible?: boolean;
  data?: { framing?: 'background' | 'subject' };
}
export interface ScenePresentation {
  viewport: { width: number; height: number };
  frame: Rectangle;
  outsideViewport: boolean;
  clipped: { id: string; bounds: Rectangle; clip: Rectangle }[];
  uninspectedCanvases: number;
}

/** Geometric evidence for review, computed on demand without another render loop. */
export function inspectPresentation(stage: HTMLElement): ScenePresentation {
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
  };
  const outside = (a: Rectangle, b: Rectangle) =>
    a.x < b.x - 1 ||
    a.y < b.y - 1 ||
    a.x + a.width > b.x + b.width + 1 ||
    a.y + a.height > b.y + b.height + 1;
  if (!stage.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return result;
  result.outsideViewport = outside(frame, { x: 0, y: 0, width: innerWidth, height: innerHeight });
  const inspect = (node: Element, object: InspectedObject, canvas = false) => {
    if (
      object.visible === false ||
      object.data?.framing === 'background' ||
      ![object.x, object.y, object.width, object.height].every(Number.isFinite)
    )
      return;
    let clip = { ...frame };
    for (
      let ancestor: Element | null = canvas ? node : node.parentElement;
      ancestor && ancestor !== stage.parentElement;
      ancestor = ancestor.parentElement
    ) {
      const style = getComputedStyle(ancestor),
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
    '[data-review-id], [data-camera-world], svg text, canvas',
  );
  for (const [index, node] of [...nodes].entries()) {
    if (!node.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const id = node.dataset.reviewId || node.id || `${node.localName}:${index}`;
    inspect(node, { id, ...rectangle(node.getBoundingClientRect()) });
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
