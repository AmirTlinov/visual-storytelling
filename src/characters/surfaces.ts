import { surface, type Surface } from '../ink/surface.js';
import { theme } from '../ink/palette.js';
import { projective, paintPlane, type Quad } from '../ink/projective.js';
import type { InkDrawing } from '../story/ink-chapter.js';
import type { ChapterFrame } from '../story/composition.js';
import type { CharacterStageOptions } from './types.js';
import type { CharacterRenderer } from './renderer.js';
import type { FrameBox } from './staging/camera.js';

export interface CharacterSurface {
  title: string;
  text?: string;
  /** Fixed logical geometry. Omit for compact/wide layouts selected from the shot's visible plane. */
  size?: { width: number; height: number };
  create(view: Surface): InkDrawing;
  /** Direct stage playback defaults; composed hosts supply their already resolved frame.values. */
  valuesAt?(frame: ChapterFrame): ChapterFrame['values'];
}
let sequence = 0;
type Snapshot = (svg: SVGSVGElement, scale?: number) => Promise<HTMLCanvasElement>;

/** Live DOM between depth-sorted passes of the same GPU renderer. No raster/async render loop. */
export function characterSurfaces(
  parent: HTMLElement,
  options: CharacterStageOptions,
  graphics: CharacterRenderer,
  snapshotSVG: Snapshot,
) {
  const definitions = options.surfaces ?? {};
  const entries = new Map<
    string,
    {
      host: HTMLDivElement;
      view: Surface;
      drawing: InkDrawing;
      definition: CharacterSurface;
      size: { width: number; height: number };
      colors?: ReturnType<typeof theme>;
      quad?: Quad;
      frame?: ChapterFrame;
    }
  >();
  const strata: HTMLCanvasElement[] = [];
  let order: (HTMLCanvasElement | string)[] = [],
    camera: FrameBox,
    layoutCamera: FrameBox;
  const cleanup = () => {
    for (const e of entries.values()) {
      e.drawing.dispose?.();
      e.colors?.dispose();
      e.view.dispose();
      e.host.remove();
    }
    entries.clear();
    for (const canvas of strata) {
      canvas.remove();
      canvas.width = canvas.height = 1;
    }
    strata.length = 0;
    order = [];
  };
  try {
    for (const [id, definition] of Object.entries(definitions)) {
      const item = options.set.staging?.objects[id];
      if (!item) throw new Error(`Unknown object for drawing surface: ${id}`);
      if (item.kind !== 'book' && item.kind !== 'board' && !item.surface?.corners)
        throw new Error(`Object ${id} needs a drawable plane`);
      const host = document.createElement('div');
      host.className = 've-character-surface';
      host.dataset.surface = id;
      host.dataset.paper = 'false';
      Object.assign(host.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        transformOrigin: '0 0',
        padding: '0',
        overflow: 'hidden',
      });
      const size = definition.size ?? { width: 640, height: 320 };
      Object.assign(host.style, { width: `${size.width}px`, height: `${size.height}px` });
      host.hidden = true;
      parent.append(host);
      let colors: ReturnType<typeof theme> | undefined, view: Surface | undefined;
      try {
        colors =
          item.surface?.theme || item.kind === 'board' || item.kind === 'book'
            ? theme(host, item.surface?.theme ?? (item.kind === 'board' ? 'dark' : 'light'))
            : undefined;
        view = surface(host, {
          id: `world-ink-${++sequence}`,
          title: definition.title,
          description: definition.text ?? definition.title,
          ...size,
          grid: false,
        });
        Object.assign(view.element.style, { width: '100%', height: '100%', display: 'block' });
        const drawing = definition.create(view);
        entries.set(id, { host, view, drawing, definition, size, colors });
      } catch (error) {
        view?.dispose();
        colors?.dispose();
        host.remove();
        throw error;
      }
      // The browser maps pointer coordinates through the homography. Respect the
      // alpha of later world passes so an occluding hand cannot click a hidden button.
      const pointer = (event: Event) => {
        if (!(event instanceof MouseEvent)) return;
        const position = order.indexOf(id);
        if (position < 0) return;
        const layers = [
          ...order.slice(position + 1).filter((v) => typeof v !== 'string'),
          graphics.canvas,
        ] as HTMLCanvasElement[];
        for (const layer of layers) {
          const box = layer.getBoundingClientRect();
          const x = Math.floor(((event.clientX - box.x) / box.width) * layer.width);
          const y = Math.floor(((event.clientY - box.y) / box.height) * layer.height);
          if (x < 0 || y < 0 || x >= layer.width || y >= layer.height) continue;
          let alpha: number;
          if (layer === graphics.canvas) {
            const pixel = new Uint8Array(4),
              gl = graphics.context.gl;
            gl.readPixels(x, layer.height - y - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            alpha = pixel[3]!;
          } else alpha = layer.getContext('2d')!.getImageData(x, y, 1, 1).data[3]!;
          if (alpha > 24) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
          }
        }
      };
      for (const name of ['pointerdown', 'pointerup', 'click'])
        host.addEventListener(name, pointer, true);
    }
  } catch (error) {
    cleanup();
    throw error;
  }
  let pass = 0;
  const projected = (quad: Quad, box: FrameBox, width: number, height: number) =>
    quad.map((p) => ({
      x: ((p.x - box.x) / box.width) * width,
      y: ((p.y - box.y) / box.height) * height,
    })) as unknown as Quad;
  const layout = (e: NonNullable<ReturnType<typeof entries.get>>, quad: Quad) => {
    // Explicit aperture dimensions remain usable under a hidden or detached host.
    const width = parseFloat(parent.style.width) || parent.clientWidth || options.set.width;
    const height = parseFloat(parent.style.height) || parent.clientHeight || options.set.height;
    if (!e.definition.size) {
      const visible = parent.getBoundingClientRect();
      const q = projected(quad, layoutCamera, visible.width || width, visible.height || height);
      const edge = (a: number, b: number) => Math.hypot(q[a]!.x - q[b]!.x, q[a]!.y - q[b]!.y);
      // Use the settled shot and a pair of layouts: camera interpolation must not
      // rebuild a diagram every frame or make rewind depend on resize history.
      const compact =
        Math.min(edge(0, 1) / 640, edge(1, 2) / 320, edge(2, 3) / 640, edge(3, 0) / 320) < 0.8;
      const next = compact ? { width: 320, height: 160 } : { width: 640, height: 320 };
      if (next.width !== e.size.width) {
        e.size = next;
        e.view.resize(next.width, next.height, false);
        Object.assign(e.host.style, { width: `${next.width}px`, height: `${next.height}px` });
      }
    }
    return projective(projected(quad, camera, width, height), e.size.width, e.size.height);
  };
  return {
    begin(
      frame: ChapterFrame,
      frameBox: FrameBox,
      focus?: readonly string[],
      resolveValues = false,
      layoutBox = frameBox,
    ) {
      camera = frameBox;
      layoutCamera = layoutBox;
      order = [];
      pass = 0;
      for (const [id, e] of entries) {
        e.quad = undefined;
        e.host.hidden = true;
        e.host.dataset.reviewFraming = focus?.includes(`${id}.content`) ? 'subject' : 'background';
        e.frame =
          resolveValues && frame.mode === 'story'
            ? { ...frame, values: { ...frame.values, ...e.definition.valuesAt?.(frame) } }
            : frame;
      }
      for (const layer of strata) layer.hidden = true;
    },
    resize() {
      for (const e of entries.values())
        if (e.quad) {
          e.host.style.transform = layout(e, e.quad)!.css;
          e.drawing.render(e.frame!, e.size);
        }
    },
    place(id: string, quad: Quad) {
      const entry = entries.get(id);
      if (!entry) return;
      const mapping = layout(entry, quad);
      if (!mapping) return; // Edge-on planes must not discard a world pass.
      entry.drawing.render(entry.frame!, entry.size);
      const { canvas, renderer, context } = graphics;
      renderer.end();
      let layer = strata[pass++];
      if (!layer) {
        layer = document.createElement('canvas');
        layer.setAttribute('aria-hidden', 'true');
        // This is a partition of the inspected world, not a second scene/model.
        Object.assign(layer, { __visualReview: () => ({ objects: [] }) });
        strata.push(layer);
      }
      if (layer.width !== canvas.width) layer.width = canvas.width;
      if (layer.height !== canvas.height) layer.height = canvas.height;
      const c = layer.getContext('2d')!;
      c.clearRect(0, 0, layer.width, layer.height);
      c.drawImage(canvas, 0, 0);
      layer.hidden = false;
      parent.insertBefore(layer, canvas);
      parent.insertBefore(entry.host, canvas);
      entry.host.style.transform = mapping.css;
      entry.host.hidden = false;
      entry.quad = quad;
      order.push(layer, id);
      context.gl.clear(context.gl.COLOR_BUFFER_BIT);
      renderer.begin();
    },
    async capture() {
      // Freeze canvases, geometry and SVG styles before any decoder can yield.
      const box = { ...camera },
        width = graphics.canvas.width,
        height = graphics.canvas.height;
      const layers = order.map((layer) => {
        if (typeof layer === 'string') {
          const e = entries.get(layer)!;
          return {
            image: snapshotSVG(e.view.element, 2),
            quad: e.quad!.map((p) => ({
              x: ((p.x - box.x) / box.width) * width,
              y: ((p.y - box.y) / box.height) * height,
            })) as unknown as Quad,
          };
        }
        const copy = document.createElement('canvas');
        copy.width = width;
        copy.height = height;
        copy.getContext('2d')!.drawImage(layer, 0, 0);
        return { image: Promise.resolve(copy), quad: undefined };
      });
      const result = document.createElement('canvas');
      result.width = width;
      result.height = height;
      const c = result.getContext('2d')!;
      const images = await Promise.all(layers.map((layer) => layer.image));
      for (const [index, layer] of layers.entries()) {
        const image = images[index]!;
        if (layer.quad) paintPlane(c, image, layer.quad);
        else c.drawImage(image, 0, 0);
      }
      return result;
    },
    snapshot: () =>
      Object.fromEntries(
        [...entries].map(([id, e]) => [
          id,
          { visible: !e.host.hidden, quad: e.quad, content: e.drawing.snapshot?.() },
        ]),
      ),
    dispose: cleanup,
  };
}
