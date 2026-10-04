import { characterRenderer, type CharacterRenderer } from './renderer.js';
import { destination } from './staging/layout.js';
import { project } from './staging/space.js';
import { stageFrame, type FrameBox } from './staging/camera.js';
import { world } from './staging/world.js';
import { performance } from './performance.js';
import { compileScore, smooth, type CharacterScore } from './score.js';
import type { CharacterStageOptions, Place, Point } from './types.js';
import { fitFrame } from '../scene-frame.js';
import { characterDetails } from './framing.js';

const NS = 'http://www.w3.org/2000/svg';
let nextStage = 0;
/** One WebGL context for the entire cast; set, props and rigs share a single viewBox. */
export async function characterStage(
  parent: HTMLElement,
  options: CharacterStageOptions,
  score: CharacterScore,
  shared?: CharacterRenderer,
) {
  const { snapshotSVG } = await import('../export/index.js');
  const { set, pack, cast } = options;
  const background = options.background !== false;
  const scope = `character-stage-${++nextStage}`;
  const graphics = shared ?? (await characterRenderer(pack));
  const { canvas, context, renderer, data, maxTextureSize } = graphics;
  const element = document.createElement('div');
  element.className = 've-character-stage';
  const aperture = document.createElement('div');
  aperture.className = 've-character-aperture';
  element.append(aperture);
  const resize = () => {
    const width = element.clientWidth || set.width,
      height = element.clientHeight || set.height,
      fit = fitFrame(set.width, set.height, width, height);
    Object.assign(aperture.style, {
      width: `${fit.width}px`,
      height: `${fit.height}px`,
      left: `${(width - fit.width) / 2}px`,
      top: `${(height - fit.height) / 2}px`,
    });
  };
  const observer = new ResizeObserver(resize);
  observer.observe(element);
  const layer = (markup = '') => {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${set.width} ${set.height}`);
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = markup.replaceAll('$id', scope);
    aperture.append(svg);
    return svg;
  };
  const back = layer(background ? set.svg : '');
  canvas.setAttribute('role', 'img');
  canvas.dataset.reviewId = 'cast';
  const front = layer();
  parent.append(element);
  resize();
  let prepared: Awaited<ReturnType<typeof world>> | undefined;
  let disposed = false;
  let inspect: (() => unknown) | undefined;
  const inspected = canvas as HTMLCanvasElement & { __visualReview?: () => unknown };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    if (inspected.__visualReview === inspect) delete inspected.__visualReview;
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
    let details: Record<string, FrameBox> = {};
    let focus: readonly string[] | undefined;
    let changingShot = false;
    inspect = () => {
      const rect = canvas.getBoundingClientRect();
      return {
        camera,
        changingShot,
        objects: Object.entries(focus ? { ...bounds, ...details } : bounds).map(([id, b]) => ({
          id,
          x: rect.x + ((b.x - camera.x) / camera.width) * rect.width,
          y: rect.y + ((b.y - camera.y) / camera.height) * rect.height,
          width: (b.width / camera.width) * rect.width,
          height: (b.height / camera.height) * rect.height,
          visible: !element.hidden,
          data: {
            framing: !changingShot && (!focus || focus.includes(id)) ? 'subject' : 'background',
          },
        })),
      };
    };

    const stage = {
      canvas,
      render(time: number, reduced = false) {
        if (disposed) return;
        graphics.activate(aperture, front);
        aperture.hidden = false;
        canvas.setAttribute('aria-label', options.description ?? 'Characters');
        inspected.__visualReview = inspect;
        const actions =
          prepared?.sample(time, reduced) ??
          Object.fromEntries(
            Object.entries(actors).map(([id, actor]) => [id, actor.sample(time, reduced)]),
          );
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
        for (const [id, node] of Object.entries(nodes)) {
          if (Number(node.getAttribute('opacity')) <= 0) continue;
          const box = node.getBBox(),
            prop = score.props[id]!,
            state = propState[id] as { at: Point };
          const scale = prop.scale ?? 1;
          bounds[id] = {
            x: state.at.x + box.x * scale,
            y: state.at.y + box.y * scale,
            width: box.width * scale,
            height: box.height * scale,
          };
        }
        details = Object.fromEntries(
          Object.entries(actors).flatMap(([id, actor]) =>
            Object.entries(characterDetails(actor.skeleton, pack.rig, set.height)).map(
              ([part, box]) => [`${id}.${part}`, box],
            ),
          ),
        );
        const index = Math.max(
          0,
          options.beats.findLastIndex((b) => score.script.cues[b.id]!.start <= time),
        );
        const beat = options.beats[index]!;
        focus = beat.shot?.focus;
        const current = stageFrame(
          set.width,
          set.height,
          beat.shot ? { ...bounds, ...details } : bounds,
          beat.shot,
        );
        const previous = stageFrame(
          set.width,
          set.height,
          options.beats[Math.max(0, index - 1)]!.shot ? { ...bounds, ...details } : bounds,
          options.beats[Math.max(0, index - 1)]!.shot,
        );
        const mix = reduced ? 1 : smooth((time - score.script.cues[beat.id]!.start) / 0.45);
        // A deliberate shot change reveals/crops artwork while travelling. Judge
        // subject fit once it arrives; retain the actual bounds throughout the move.
        changingShot =
          mix < 1 &&
          (Object.keys(current) as (keyof FrameBox)[]).some(
            (key) => Math.abs(current[key] - previous[key]) > 0.01,
          );
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
        snapshot = {
          time,
          camera,
          bounds,
          details,
          framing: {
            focus: beat.shot?.focus ?? Object.keys(bounds),
            changingShot,
            clipped: Object.entries(beat.shot ? { ...bounds, ...details } : bounds)
              .filter(
                ([id, b]) =>
                  !changingShot &&
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
      /** Flatten only a requested transition boundary; live content keeps all DOM layers. */
      async capture() {
        const cast = document.createElement('canvas');
        cast.width = canvas.width;
        cast.height = canvas.height;
        cast.getContext('2d')!.drawImage(canvas, 0, 0);
        const images = await Promise.all([back, front].map((svg) => snapshotSVG(svg, 1)));
        const result = document.createElement('canvas');
        result.width = cast.width;
        result.height = cast.height;
        const c = result.getContext('2d')!;
        c.drawImage(images[0]!, 0, 0, result.width, result.height);
        c.drawImage(cast, 0, 0);
        c.drawImage(images[1]!, 0, 0, result.width, result.height);
        return result;
      },
      show(visible: boolean) {
        if (!disposed) {
          element.hidden = !visible;
          if (visible) resize();
        }
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
