import {
  ManagedWebGLRenderingContext,
  SceneRenderer,
  GLTexture,
} from '@esotericsoftware/spine-webgl';
import { unpackCharacter, readSkeleton, performance } from './performance.js';
import { compileScore, smooth, type CharacterScore } from './score.js';
import type { CharacterStageOptions, Place, Point } from './types.js';

const NS = 'http://www.w3.org/2000/svg';
let nextStage = 0;
/** One WebGL context for the entire cast; set, props and rigs share a single viewBox. */
export async function characterStage(
  parent: HTMLElement,
  options: CharacterStageOptions,
  score: CharacterScore,
) {
  const { set, pack, cast } = options;
  const background = options.background !== false;
  const scope = `character-stage-${++nextStage}`;
  const source = await unpackCharacter(pack);
  const texture = new Image();
  texture.src = source.texture;
  await texture.decode();
  const { atlas, data } = readSkeleton(source);
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
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', options.description ?? 'Characters');
  canvas.dataset.reviewId = 'cast';
  element.append(canvas);
  const front = layer();
  parent.append(element);
  let context: ManagedWebGLRenderingContext | undefined;
  let renderer: SceneRenderer | undefined;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    atlas.dispose();
    renderer?.dispose();
    context?.dispose();
    context?.gl.getExtension('WEBGL_lose_context')?.loseContext();
    canvas.width = canvas.height = 1;
    element.remove();
  };
  try {
    context = new ManagedWebGLRenderingContext(canvas, {
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    const maxTextureSize = context.gl.getParameter(context.gl.MAX_TEXTURE_SIZE) as number;
    renderer = new SceneRenderer(canvas, context);
    for (const page of atlas.pages) page.setTexture(new GLTexture(context, texture, false));
    renderer.camera.position.set(set.width / 2, set.height / 2, 0);
    renderer.camera.setViewport(set.width, set.height);
    const point = (at: string | Point) => (typeof at === 'string' ? set.spots[at]! : at);
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
    for (const actor of background ? Object.values(cast) : []) {
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
    const stage = {
      canvas,
      render(time: number, reduced = false) {
        if (disposed) return;
        const actions = Object.fromEntries(
          Object.entries(actors).map(([id, actor]) => [id, actor.sample(time, reduced)]),
        );
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
        for (const id of order) renderer!.drawSkeleton(actors[id]!.skeleton);
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
          actions,
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
};
