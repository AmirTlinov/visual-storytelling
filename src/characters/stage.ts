import { characterRenderer, type CharacterRenderer } from './renderer.js';
import { destination } from './staging/layout.js';
import { project } from './staging/space.js';
import { stageFrame, type FrameBox } from './staging/camera.js';
import { world } from './staging/world.js';
import { performance } from './performance.js';
import { compileScore, smooth, type CharacterScore } from './score.js';
import type { CharacterStageOptions, Place, Point } from './types.js';

const NS = 'http://www.w3.org/2000/svg';
let nextStage = 0;
/** One WebGL context for the entire cast; set, props and rigs share a single viewBox. */
export async function characterStage(
  parent: HTMLElement,
  options: CharacterStageOptions,
  score: CharacterScore,
  shared?: CharacterRenderer,
) {
  const { set, pack, cast } = options;
  const background = options.background !== false;
  const scope = `character-stage-${++nextStage}`;
  const graphics = shared ?? (await characterRenderer(pack));
  const { canvas, context, renderer, data, maxTextureSize } = graphics;
  const element = document.createElement('div');
  element.className = 've-character-stage';
  const layer = (markup = '') => {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${set.width} ${set.height}`);
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = markup.replaceAll('$id', scope);
    element.append(svg);
    return svg;
  };
  const back = layer(background ? set.svg : '');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', options.description ?? 'Characters');
  canvas.dataset.reviewId = 'cast';
  element.append(canvas);
  const front = layer();
  parent.append(element);
  let prepared: Awaited<ReturnType<typeof world>> | undefined;
  let disposed = false;
  const inspected = canvas as HTMLCanvasElement & { __visualReview?: () => unknown };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    delete inspected.__visualReview;
    prepared?.dispose();
    if (!shared) graphics.dispose();
    element.remove();
  };
  try {
    const point = (at: CharacterStageOptions['cast'][string]['at']): Point => {
      if (set.staging && !(typeof at === 'object' && 'y' in at))
        return project(set.staging.projection, destination(set.staging, at));
      return typeof at === 'string' ? set.spots[at]! : (at as Point);
    };
    const actors = Object.fromEntries(
      Object.entries(cast).map(([id, actor]) => [
        id,
        performance(
          data,
          pack,
          actor,
          score.tracks[id]!,
          point(actor.at),
          set.height,
          options.blend,
        ),
      ]),
    );
    if (score.blocking) prepared = await world(options, score.blocking, actors, context);
    for (const actor of background && !prepared ? Object.values(cast) : []) {
      const at = point(actor.at),
        scale = actor.scale ?? 0.77;
      const shadow = document.createElementNS(NS, 'ellipse');
      for (const [key, value] of Object.entries({
        cx: at.x + 7,
        cy: at.y + 11,
        rx: 175 * scale,
        ry: 22 * scale,
        fill: '#243c3f',
        opacity: 0.5,
      }))
        shadow.setAttribute(key, String(value));
      back.append(shadow);
    }
    const order = Object.keys(cast).sort((a, b) => point(cast[a]!.at).y - point(cast[b]!.at).y);
    function resolve(at: Place): Point {
      return typeof at === 'string'
        ? point(at)
        : 'actor' in at
          ? actors[at.actor]!.anchor(at.anchor)
          : at;
    }
    const nodes = Object.fromEntries(
      (background ? Object.entries(score.props) : []).map(([id, prop]) => {
        const group = document.createElementNS(NS, 'g');
        group.innerHTML = prop.art.svg.replaceAll('$id', `${scope}-${id}`);
        group.dataset.reviewId = id;
        (prop.layer === 'back' ? back : front).append(group);
        return [id, group];
      }),
    );
    let snapshot: unknown;
    let camera: FrameBox = { x: 0, y: 0, width: set.width, height: set.height },
      bounds: Record<string, FrameBox> = {};
    const inspect = () => {
      const rect = canvas.getBoundingClientRect();
      return {
        camera,
        objects: Object.entries(bounds).map(([id, b]) => ({
          id,
          x: rect.x + ((b.x - camera.x) / camera.width) * rect.width,
          y: rect.y + ((b.y - camera.y) / camera.height) * rect.height,
          width: (b.width / camera.width) * rect.width,
          height: (b.height / camera.height) * rect.height,
          visible: !element.hidden,
          data: { framing: 'subject' },
        })),
      };
    };
    const backgroundImage = new Image();
    backgroundImage.src =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(new XMLSerializer().serializeToString(back));
    await backgroundImage.decode();
    const stage = {
      canvas,
      render(time: number, reduced = false) {
        if (disposed) return;
        graphics.activate(element, front);
        canvas.setAttribute('aria-label', options.description ?? 'Characters');
        inspected.__visualReview = inspect;
        const actions =
          prepared?.sample(time, reduced) ??
          Object.fromEntries(
            Object.entries(actors).map(([id, actor]) => [id, actor.sample(time, reduced)]),
          );
        bounds = {
          ...prepared?.bounds(),
          ...Object.fromEntries(
            Object.entries(actors).map(([id, actor]) => {
              const b = actor.skeleton.getBoundsRect();
              return [
                id,
                { x: b.x, y: set.height - b.y - b.height, width: b.width, height: b.height },
              ];
            }),
          ),
        };
        const index = Math.max(
          0,
          options.beats.findLastIndex((b) => score.script.cues[b.id]!.start <= time),
        );
        const beat = options.beats[index]!;
        const current = stageFrame(set.width, set.height, bounds, beat.shot);
        const previous = stageFrame(
          set.width,
          set.height,
          bounds,
          options.beats[Math.max(0, index - 1)]!.shot,
        );
        const mix = reduced ? 1 : smooth((time - score.script.cues[beat.id]!.start) / 0.45);
        camera = Object.fromEntries(
          Object.keys(current).map((k) => {
            const key = k as keyof FrameBox;
            return [key, previous[key] + (current[key] - previous[key]) * mix];
          }),
        ) as unknown as FrameBox;
        for (const svg of [back, front])
          svg.setAttribute('viewBox', `${camera.x} ${camera.y} ${camera.width} ${camera.height}`);
        renderer!.camera.position.set(
          camera.x + camera.width / 2,
          set.height - camera.y - camera.height / 2,
          0,
        );
        renderer!.camera.setViewport(camera.width, camera.height);
        // Logical dimensions also work when the host is hidden or detached.
        const dpr = Math.min(
          devicePixelRatio || 1,
          2,
          maxTextureSize / set.width,
          maxTextureSize / set.height,
        );
        const width = Math.max(1, Math.round(set.width * dpr)),
          height = Math.max(1, Math.round(set.height * dpr));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        const gl = context!.gl;
        gl.viewport(0, 0, width, height);
        renderer!.camera.update();
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        renderer!.begin();
        if (prepared) prepared.draw(renderer!);
        else for (const id of order) renderer!.drawSkeleton(actors[id]!.skeleton);
        renderer!.end();
        const propState: Record<string, unknown> = {};
        for (const [id, prop] of Object.entries(score.props)) {
          const key = score.propTracks[id]!.findLast((key) => key.start <= time);
          const from = key?.from ?? prop,
            to = key?.to ?? prop;
          const p = key
            ? reduced
              ? 1
              : smooth((time - key.start) / Math.max(0.001, key.end - key.start))
            : 1;
          const a = resolve(from.at!),
            b = resolve(to.at!);
          const at = {
            x: a.x + (b.x - a.x) * p,
            y: a.y + (b.y - a.y) * p - (key?.arc ?? 0) * 4 * p * (1 - p),
          };
          const opacity = (from.opacity ?? 1) + ((to.opacity ?? 1) - (from.opacity ?? 1)) * p;
          const values = Object.fromEntries(
            Object.keys({ ...from.values, ...to.values }).map((name) => {
              const a = from.values?.[name] ?? 0,
                b = to.values?.[name] ?? a;
              return [name, a + (b - a) * p];
            }),
          );
          const node = nodes[id];
          if (node) {
            node.setAttribute('transform', `translate(${at.x} ${at.y}) scale(${prop.scale ?? 1})`);
            node.setAttribute('opacity', String(opacity));
            prop.art.paint?.(node, values);
          }
          propState[id] = { at, opacity, values };
        }
        snapshot = {
          time,
          camera,
          bounds,
          framing: {
            focus: beat.shot?.focus ?? Object.keys(bounds),
            clipped: Object.entries(bounds)
              .filter(
                ([id, b]) =>
                  (!beat.shot || beat.shot.focus.includes(id)) &&
                  (b.x < camera.x - 0.1 ||
                    b.y < camera.y - 0.1 ||
                    b.x + b.width > camera.x + camera.width + 0.1 ||
                    b.y + b.height > camera.y + camera.height + 0.1),
              )
              .map(([id]) => id),
          },
          actions,
          world: prepared?.snapshot(),
          props: propState,
          anchors: Object.fromEntries(
            Object.entries(actors).map(([id, actor]) => [
              id,
              Object.fromEntries(
                Object.keys(pack.anchors).map((name) => [name, actor.anchor(name)]),
              ),
            ]),
          ),
        };
      },
      snapshot: () => snapshot,
      /** Paint the prepared scene into a book page or another host-owned canvas. */
      paintTo(target: CanvasRenderingContext2D, box: FrameBox) {
        if (Object.keys(score.props).length)
          throw new Error(
            'Canvas chapters use prepared stage objects; SVG props remain in CharacterStage',
          );
        target.save();
        target.beginPath();
        target.rect(box.x, box.y, box.width, box.height);
        target.clip();
        target.drawImage(
          backgroundImage,
          box.x - (camera.x / camera.width) * box.width,
          box.y - (camera.y / camera.height) * box.height,
          (set.width / camera.width) * box.width,
          (set.height / camera.height) * box.height,
        );
        target.drawImage(canvas, box.x, box.y, box.width, box.height);
        target.restore();
      },
      show(visible: boolean) {
        if (!disposed) element.hidden = !visible;
      },
      dispose,
    };
    stage.render(0);
    return stage;
  } catch (error) {
    dispose();
    throw error;
  }
}
/** A stage without a player: the host supplies absolute time and owns its lifecycle. */
export const CharacterStage = {
  mount(parent: HTMLElement, options: CharacterStageOptions) {
    return characterStage(parent, options, compileScore(options));
  },
  async mountMany(parent: HTMLElement, options: readonly CharacterStageOptions[]) {
    if (!options.length) throw new Error('A cast sequence needs at least one stage');
    const pack = options[0]!.pack;
    if (options.some((o) => o.pack.gzip !== pack.gzip))
      throw new Error('Chapters share one character pack');
    const scores = options.map(compileScore),
      graphics = await characterRenderer(pack);
    const stages: Awaited<ReturnType<typeof characterStage>>[] = [];
    try {
      for (const [i, entry] of options.entries()) {
        const stage = await characterStage(parent, entry, scores[i]!, graphics);
        stage.show(false);
        stages.push(stage);
      }
      return {
        canvas: graphics.canvas,
        render(index: number, time: number, reduced = false) {
          const stage = stages[index];
          if (!stage) throw new Error(`Unknown character chapter: ${index}`);
          stage.show(true);
          stage.render(time, reduced);
          return stage;
        },
        dispose() {
          for (const stage of stages) stage.dispose();
          graphics.dispose();
        },
      };
    } catch (error) {
      for (const stage of stages) stage.dispose();
      graphics.dispose();
      throw error;
    }
  },
};
