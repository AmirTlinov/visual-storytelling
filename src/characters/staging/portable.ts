import {
  GLTexture,
  type ManagedWebGLRenderingContext,
  type SceneRenderer,
} from '@esotericsoftware/spine-webgl';
import type { Furniture, GroundPoint } from './types.js';
import type { Point } from '../types.js';
export interface CarriedFrame extends Point {
  id: string;
  scale: number;
  portable: true;
}
export const portableBounds = (frame: CarriedFrame, art: NonNullable<Furniture['art']>) => ({
  x: frame.x - (art.width * frame.scale) / 2,
  y: frame.y - art.height * frame.scale,
  width: art.width * frame.scale,
  height: art.height * frame.scale,
});
/** Each portable appearance supplies one resting point and one hand contact. */
export function portable(
  kind: 'letter' | 'cup' | 'instrument',
  at: GroundPoint,
  color?: string,
): Furniture {
  const ink = '#304650';
  const drawings: Record<typeof kind, NonNullable<Furniture['art']>> = {
    letter: {
      width: 72,
      height: 50,
      grip: { x: -27, y: -18 },
      svg: `<path d="M-36 0v-50h72V0Z" fill="#f1eee3"/><path d="m-35-49 35 29 35-29M-35-1l23-24m24 0 23 24" fill="none"/>`,
    },
    cup: {
      width: 92,
      height: 60,
      grip: { x: 23, y: -30 },
      svg: `<path d="M18-48q26-6 22 17-2 18-21 12" fill="none"/><path d="M-27-55h46l-3 45q-20 18-40 0Z" fill="${color ?? '#8daeba'}"/><ellipse cx="-4" cy="-55" rx="23" ry="5" fill="#d2be9b"/>`,
    },
    instrument: {
      title: 'Измерительный прибор',
      width: 80,
      height: 92,
      grip: { x: -31, y: -24 },
      svg: `<path d="M-40 0v-92h80V0Z" fill="${color ?? '#af9875'}"/><path d="M-29-81h58v42h-58Z" fill="#ebe8d7"/><path data-reading d="m-22-47 22-25 17 23" fill="none"/><circle data-button cy="-19" r="8" fill="#658f84"/>`,
      paint(node, { active = 0 }) {
        node
          .querySelector('[data-reading]')!
          .setAttribute('d', `m-22-47 ${22 + active * 16}-25 ${17 - active * 16} 23`);
        node.querySelector('[data-button]')!.setAttribute('fill', active ? '#ead67d' : '#658f84');
      },
    },
  };
  const art = drawings[kind];
  const wrap = (svg: string) =>
    `<g stroke="${ink}" stroke-width="2.6" stroke-linejoin="round">${svg}</g>`;
  return {
    kind: 'prop',
    at,
    scale: 0.72,
    color,
    art: {
      ...art,
      svg: wrap(art.svg),
    },
    ...(kind === 'instrument'
      ? { trigger: { at: { x: 0, z: 0, height: 0.19 }, effect: 'toggle' as const } }
      : {}),
  };
}
export async function portableArt(
  context: ManagedWebGLRenderingContext,
  objects: Readonly<Record<string, Furniture>>,
) {
  const textures = new Map<string, GLTexture>();
  const dispose = () => {
    for (const texture of textures.values()) texture.dispose();
    textures.clear();
  };
  try {
    for (const [id, item] of Object.entries(objects))
      if (item.kind === 'prop' && !item.art!.paint) {
        const art = item.art!;
        const image = new Image();
        image.src =
          'data:image/svg+xml;charset=utf-8,' +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${art.width * 2}" height="${art.height * 2}" viewBox="${-art.width / 2} ${-art.height} ${art.width} ${art.height}">${art.svg}</svg>`,
          );
        await image.decode();
        textures.set(id, new GLTexture(context, image, false));
      }
    return {
      draw(renderer: SceneRenderer, frame: CarriedFrame, height: number) {
        const texture = textures.get(frame.id);
        if (!texture) return;
        const box = portableBounds(frame, objects[frame.id]!.art!);
        renderer.drawTexture(texture, box.x, height - box.y - box.height, box.width, box.height);
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
