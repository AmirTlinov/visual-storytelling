import { characterRenderer, type CharacterRenderer } from './renderer.js';
import { destination } from './staging/layout.js';
import { project } from './staging/space.js';
import { stageFrame, type FrameBox } from './staging/camera.js';
import { world } from './staging/world.js';
import { performance } from './performance.js';
import { compileScore, smooth, type CharacterScore } from './score.js';
import type { CharacterStageOptions, Place, Point } from './types.js';
import { fitFrame } from '../scene-frame.js';
import { characterSurfaces } from './surfaces.js';
import type { Shot } from './staging/types.js';
import type { ChapterFrame } from '../story/composition.js';
import { characterDetails } from './framing.js';
import { snapshotSVG } from '../export/index.js';

const NS = 'http://www.w3.org/2000/svg';
let nextStage = 0;
interface CaptureView {
  camera?: FrameBox;
  omit?: readonly string[];
}
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
  const aperture = document.createElement('div');
  let surfaces: ReturnType<typeof characterSurfaces> | undefined;
  aperture.className = 've-character-aperture';
  element.append(aperture);
  let replay: (() => void) | undefined;
  const resize = () => {
    const width = element.clientWidth || parseFloat(aperture.style.width) || set.width,
      height = element.clientHeight || parseFloat(aperture.style.height) || set.height,
      fit =
        options.camera === 'responsive'
          ? { width, height }
          : fitFrame(set.width, set.height, width, height);
    const changed =
      parseFloat(aperture.style.width) !== fit.width ||
      parseFloat(aperture.style.height) !== fit.height;
    Object.assign(aperture.style, {
      width: `${fit.width}px`,
      height: `${fit.height}px`,
      left: `${(width - fit.width) / 2}px`,
      top: `${(height - fit.height) / 2}px`,
    });
    surfaces?.resize();
    if (changed && !element.hidden && canvas.parentElement === aperture) replay?.();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(element);
  const layer = (markup = '') => {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${set.width} ${set.height}`);
    svg.setAttribute('aria-hidden', 'true');
    svg.style.pointerEvents = 'none';
    svg.innerHTML = markup.replaceAll('$id', scope);
    aperture.append(svg);
    return svg;
  };
  const back = layer(background ? set.svg : '');
  const backdrop =
    background && set.backdrop
      ? ['above', 'below'].map((part) => {
          const rect = document.createElementNS(NS, 'rect');
          rect.setAttribute(
            'fill',
            set.backdrop![part as 'above' | 'below'].replaceAll('$id', scope),
          );
          return rect;
        })
      : [];
  back.prepend(...backdrop);
  canvas.setAttribute('role', 'img');
  canvas.dataset.reviewId = 'cast';
  const front = layer();
  parent.append(element);
  resize();
  let prepared: Awaited<ReturnType<typeof world>> | undefined;
  let disposed = false;
  let releasePresentation: (() => void) | undefined;
  let inspect: (() => unknown) | undefined;
  const inspected = canvas as HTMLCanvasElement & { __visualReview?: () => unknown };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    replay = undefined;
    observer.disconnect();
    if (inspected.__visualReview === inspect) delete inspected.__visualReview;
    surfaces?.dispose();
    releasePresentation?.();
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
    if (Object.keys(options.surfaces ?? {}).length) {
      if (!prepared) throw new Error('Drawing surfaces need a prepared world');
      surfaces = characterSurfaces(aperture, options, graphics, snapshotSVG);
    }
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
    let manualShot: Shot | undefined;
    let latest: [number, boolean, ChapterFrame | undefined] = [0, false, undefined];
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

    const sample = (time: number, reduced: boolean) => {
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
      return { actions, propState };
    };

    const stage = {
      get set() {
        return set;
      },
      get canvas() {
        if (surfaces)
          throw new Error(
            'This stage has live Ink surfaces. Use await stage.capture() for a complete image; canvas is available for canvas-only stages.',
          );
        return canvas;
      },
      render(time: number, reduced = false, frame?: ChapterFrame, captureView?: CaptureView) {
        if (disposed) return;
        latest = [time, reduced, frame];
        graphics.activate(aperture, front);
        aperture.hidden = false;
        canvas.setAttribute('aria-label', options.description ?? 'Characters');
        inspected.__visualReview = inspect;
        const index = Math.max(
          0,
          options.beats.findLastIndex((b) => score.script.cues[b.id]!.start <= time),
        );
        const authoredBeat = options.beats[index]!;
        const beat = manualShot ? { ...authoredBeat, shot: manualShot } : authoredBeat;
        const aspect =
          options.camera === 'responsive'
            ? parseFloat(aperture.style.width) / parseFloat(aperture.style.height)
            : undefined;
        focus = beat.shot?.focus;
        const mix =
          reduced || manualShot ? 1 : smooth((time - score.script.cues[beat.id]!.start) / 0.45);
        const previousShot = options.beats[Math.max(0, index - 1)]!.shot;
        const differentShot =
          previousShot?.framing !== beat.shot?.framing ||
          previousShot?.focus.length !== beat.shot?.focus.length ||
          previousShot?.focus.some((id) => !beat.shot?.focus.includes(id));
        let previous: FrameBox | undefined;
        if (mix < 1 && differentShot) {
          // The outgoing subject may disappear during this beat. Sample its shot
          // at the boundary, then restore the current pose before drawing any layer.
          sample(score.script.cues[beat.id]!.start, false);
          previous = stageFrame(
            set.width,
            set.height,
            previousShot ? { ...bounds, ...details } : bounds,
            previousShot,
            aspect,
          );
        }
        const { actions, propState } = sample(time, reduced);
        const current = stageFrame(
          set.width,
          set.height,
          beat.shot ? { ...bounds, ...details } : bounds,
          beat.shot,
          aspect,
        );
        previous ??= current;
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
        camera = captureView?.camera ?? camera;
        for (const [i, rect] of backdrop.entries()) {
          const top = i ? Math.max(camera.y, set.backdrop!.divide) : camera.y;
          const bottom = i
            ? camera.y + camera.height
            : Math.min(camera.y + camera.height, set.backdrop!.divide);
          for (const [key, value] of Object.entries({
            x: camera.x,
            y: top,
            width: camera.width,
            height: Math.max(0, bottom - top),
          }))
            rect.setAttribute(key, String(value));
        }
        for (const svg of [back, front])
          svg.setAttribute('viewBox', `${camera.x} ${camera.y} ${camera.width} ${camera.height}`);
        renderer!.camera.position.set(
          camera.x + camera.width / 2,
          set.height - camera.y - camera.height / 2,
          0,
        );
        renderer!.camera.setViewport(camera.width, camera.height);
        // Logical dimensions also work when the host is hidden or detached.
        const logicalHeight = set.height,
          logicalWidth = (logicalHeight * camera.width) / camera.height;
        const dpr = Math.min(
          devicePixelRatio || 1,
          2,
          maxTextureSize / logicalWidth,
          maxTextureSize / logicalHeight,
        );
        const width = Math.max(1, Math.round(logicalWidth * dpr)),
          height = Math.max(1, Math.round(logicalHeight * dpr));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        const gl = context!.gl;
        gl.viewport(0, 0, width, height);
        renderer!.camera.update();
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        surfaces?.begin(
          frame ?? {
            time,
            progress: time / score.script.duration,
            reduced,
            mode: 'story',
            values: {},
          },
          camera,
          focus,
          !frame,
          current,
        );
        renderer!.begin();
        try {
          if (prepared) prepared.draw(renderer!, surfaces?.place, captureView?.omit);
          else for (const id of order) renderer!.drawSkeleton(actors[id]!.skeleton);
        } finally {
          renderer!.end();
        }
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
          surfaces: surfaces?.snapshot(),
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
      focus(ids: readonly string[]) {
        if (ids.some((id) => !Object.hasOwn({ ...bounds, ...details }, id)))
          throw new Error('Unknown camera subject');
        manualShot = { focus: ids, framing: 'detail' };
        stage.render(...latest);
      },
      reset() {
        manualShot = undefined;
        if (snapshot) stage.render(...latest);
      },
      snapshot: () => snapshot,
      /** Flatten only a requested transition boundary; live content keeps all DOM layers. */
      restingBook: (id: string) => prepared?.restingBook(id),
      /** A host-driven presentation borrows a surface while its world keeps sampling time. */
      presentSurface(id: string, parent: HTMLElement) {
        if (disposed || !surfaces)
          throw new Error('A presentation needs an active drawing surface');
        if (releasePresentation) throw new Error('The stage already presents a drawing surface');
        const drawing = surfaces.present(id, parent),
          releaseDrawing = drawing.release,
          visibility = element.style.visibility;
        let released = false;
        element.style.visibility = 'hidden';
        const release = () => {
          if (released) return;
          released = true;
          releasePresentation = undefined;
          try {
            releaseDrawing();
          } finally {
            element.style.visibility = visibility;
          }
        };
        releasePresentation = release;
        drawing.release = release;
        return drawing;
      },
      async capture(captureView?: CaptureView) {
        if (disposed || !snapshot || canvas.parentElement !== aperture)
          throw new Error('Render the active character stage before capture');
        const restore = latest;
        const visibility = element.style.visibility;
        const cast = document.createElement('canvas');
        let captured;
        try {
          if (releasePresentation) element.style.visibility = 'visible';
          if (captureView) stage.render(...restore, captureView);
          cast.width = canvas.width;
          cast.height = canvas.height;
          cast.getContext('2d')!.drawImage(canvas, 0, 0);
          captured = Promise.all([
            snapshotSVG(back, cast.width / back.viewBox.baseVal.width),
            surfaces?.capture(),
            snapshotSVG(front, cast.width / front.viewBox.baseVal.width),
          ]);
        } finally {
          try {
            if (captureView) stage.render(...restore);
          } finally {
            element.style.visibility = visibility;
          }
        }
        const [background, layers, foreground] = await captured;
        const result = document.createElement('canvas');
        result.width = cast.width;
        result.height = cast.height;
        const c = result.getContext('2d')!;
        c.drawImage(background, 0, 0, result.width, result.height);
        if (layers) c.drawImage(layers, 0, 0);
        c.drawImage(cast, 0, 0);
        c.drawImage(foreground, 0, 0, result.width, result.height);
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
    replay = () => stage.render(...latest);
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
    let active: Awaited<ReturnType<typeof characterStage>> | undefined;
    try {
      for (const [i, entry] of options.entries()) {
        const stage = await characterStage(parent, entry, scores[i]!, graphics);
        stage.show(false);
        stages.push(stage);
      }
      return {
        get canvas() {
          if (options.some((o) => Object.keys(o.surfaces ?? {}).length))
            throw new Error(
              'This cast sequence has live Ink surfaces. Capture its rendered stage for a complete image.',
            );
          return graphics.canvas;
        },
        render(index: number, time: number, reduced = false) {
          const stage = stages[index];
          if (!stage) throw new Error(`Unknown character chapter: ${index}`);
          if (active !== stage) active?.show(false);
          stage.show(true);
          stage.render(time, reduced);
          active = stage;
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
