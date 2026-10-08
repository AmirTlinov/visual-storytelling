import { portableArt, portableBounds, type CarriedFrame } from './portable.js';
import type { CharacterCompositor } from '../compositor.js';
import type { CharacterStageOptions } from '../types.js';
import type { performance } from '../performance.js';
import type { Blocking } from './blocking.js';
import { blockAt } from './motion.js';
import { body, connect } from './pose.js';
import { drawFurniture, furnitureParts, loadFurniture, color } from './furniture.js';
import { drawBook, bookPage, bookBounds, type BookFrame } from './book.js';
import { notebookFaces } from './notebook.js';
import { drawingPlane } from './drawing-plane.js';
import type { Quad } from '../../ink/projective.js';
import { project } from './space.js';
import { union, type FrameBox } from './camera.js';

type Performer = ReturnType<typeof performance>;
/** Prepared world shares the existing cast renderer and absolute story time. */
export async function world(
  options: CharacterStageOptions,
  blocking: Blocking,
  actors: Record<string, Performer>,
  graphics?: CharacterCompositor,
) {
  const { staging } = blocking,
    { height } = options.set;
  const bodies = Object.fromEntries(
    Object.entries(actors).map(([id, perf]) => [
      id,
      body(perf, options.cast[id]!, options.pack.rig!, staging.projection, height),
    ]),
  );
  let frames = blockAt(blocking, 0);
  const furniture = await loadFurniture(
    options.background === false ? {} : staging.objects,
    staging.projection,
  );
  let props: Awaited<ReturnType<typeof portableArt>> | undefined;
  try {
    if (graphics) props = await portableArt(staging.objects);
  } catch (error) {
    furniture.dispose();
    throw error;
  }
  type ItemFrame = BookFrame | CarriedFrame;
  const bookContent = (frame: BookFrame) => {
    const size = options.surfaces?.[frame.id]?.size;
    return bookPage(frame, size ? size.width / size.height : 2);
  };
  const drawItem = (
    renderer: CharacterCompositor,
    frame: ItemFrame,
    surface?: (id: string, quad: Quad) => void,
  ) => {
    if ('portable' in frame) {
      props?.draw(renderer, frame, height);
      if (options.surfaces?.[frame.id])
        surface?.(
          frame.id,
          drawingPlane(staging.objects[frame.id]!, staging.projection, undefined, frame).quad,
        );
    } else
      drawBook(
        renderer,
        frame,
        height,
        options.surfaces?.[frame.id]
          ? () => {
              const quad = bookContent(frame);
              if (quad) surface?.(frame.id, quad);
            }
          : undefined,
      );
  };
  let heldItems: Record<string, ItemFrame> = {};
  const restingFrame = (id: string): ItemFrame => {
    const item = staging.objects[id]!,
      at = frames.items[id]!,
      p = project(staging.projection, at),
      base = { id, x: p.x, y: p.y, scale: p.scale * (item.scale ?? 0.72) };
    if (item.kind === 'prop') return { ...base, portable: true };
    const open = frames.objects[id] ?? 0;
    return {
      ...base,
      open,
      turn: 0,
      handTurn: 0,
      color: item.color ?? '#855057',
      resting: { faces: notebookFaces({ ...item, at, open }, staging.projection), weight: 1 },
    };
  };
  let itemFrames: Record<string, ItemFrame> = {};
  return {
    sample(time: number, reduced: boolean) {
      frames = blockAt(blocking, time, reduced);
      heldItems = {};
      itemFrames = {};
      const actions = Object.fromEntries(
        Object.entries(bodies).map(([id, b]) => [id, b.sample(time, frames.actors[id]!, reduced)]),
      );
      for (const pair of frames.pairs) connect(bodies, pair);
      for (const [id, b] of Object.entries(bodies)) {
        const transfer = b.frame.transfer,
          itemId = transfer?.id ?? b.frame.holding;
        if (itemId) {
          const item = staging.objects[itemId]!,
            target = transfer && project(staging.projection, transfer.at);
          const placement =
            transfer && target
              ? {
                  x: target.x,
                  y: target.y,
                  scale: target.scale * (item.scale ?? 0.72),
                  weight: transfer.taking ? 1 - transfer.progress : transfer.progress,
                  grip: transfer.grip,
                }
              : undefined;
          heldItems[id] =
            item.kind === 'prop'
              ? b.carry(itemId, item.art!, placement)
              : b.book(
                  itemId,
                  item.color ?? '#855057',
                  frames.objects[itemId] ?? 0,
                  placement && {
                    ...placement,
                    resting: notebookFaces(
                      { ...item, at: transfer!.at, open: frames.objects[itemId] ?? 0 },
                      staging.projection,
                    ),
                  },
                );
          itemFrames[itemId] = heldItems[id]!;
        }
      }
      for (const id of Object.keys(frames.items))
        if (!itemFrames[id]) itemFrames[id] = restingFrame(id);
      return actions;
    },
    draw(
      renderer: CharacterCompositor,
      surface?: (id: string, quad: Quad) => void,
      omit: readonly string[] = [],
    ) {
      const items: { depth: number; draw: () => void }[] = furniture.parts
        .filter((part) => !omit.includes(part.id))
        .map((part) => ({
          depth: part.depth,
          draw: () => {
            const b = part.bounds;
            renderer.image(part.texture, { ...b, y: height - b.y - b.height });
          },
        }));
      if (options.background !== false)
        for (const [id, item] of Object.entries(staging.objects))
          if (item.kind === 'door' && !omit.includes(id))
            for (const part of furnitureParts(item, staging.projection, frames.objects[id] ?? 0))
              items.push({ depth: part.depth, draw: () => drawFurniture(renderer, part, height) });
      for (const id of Object.keys(options.surfaces ?? {})) {
        const object = staging.objects[id]!;
        if (
          object.kind !== 'book' &&
          object.kind !== 'prop' &&
          options.background !== false &&
          !omit.includes(id)
        ) {
          const plane = drawingPlane(object, staging.projection, frames.items[id] ?? object.at);
          items.push({ depth: plane.depth, draw: () => surface?.(id, plane.quad) });
        }
      }
      const held = new Set(Object.values(heldItems).map((b) => b.id));
      if (options.background !== false)
        for (const [id, frame] of Object.entries(itemFrames))
          if (!held.has(id) && !omit.includes(id)) {
            items.push({
              depth: frames.items[id]!.z - 0.001,
              draw: () => drawItem(renderer, frame, surface),
            });
          }
      for (const [id, b] of Object.entries(bodies))
        items.push({
          depth: b.frame.at.z,
          draw: () => {
            if (options.background !== false) {
              const at = project(staging.projection, b.frame.at),
                ps: number[] = [];
              for (let i = 0; i < 32; i++) {
                const a = (i / 32) * Math.PI * 2;
                ps.push(
                  at.x + Math.cos(a) * 88 * b.scale,
                  height - at.y + Math.sin(a) * 13 * b.scale,
                );
              }
              renderer.polygon(
                Array.from({ length: 32 }, (_, i) => ({ x: ps[i * 2]!, y: ps[i * 2 + 1]! })),
                color('#344f47', 0.22),
              );
            }
            const item = heldItems[id];
            if (item) {
              const order = b.perf.orderedMeshes(),
                torso = order.findIndex(
                  (mesh) => mesh.userData.slot === options.pack.rig!.bodySlot,
                ),
                arms = order
                  .map((mesh, index) =>
                    options.pack.rig!.frontArms.includes(mesh.userData.slot) ? index : -1,
                  )
                  .filter((index) => index >= 0),
                index = arms.find((index) => index > torso) ?? arms[0] ?? order.length;
              renderer.actor(b.perf, order.slice(0, index));
              if (!omit.includes(item.id)) drawItem(renderer, item, surface);
              renderer.actor(b.perf, order.slice(index));
            } else renderer.actor(b.perf);
          },
        });
      items.sort((a, b) => b.depth - a.depth);
      for (const item of items) item.draw();
    },
    bounds: () => {
      const grouped: Record<string, FrameBox[]> = {};
      const add = (id: string, bounds: FrameBox) => {
        (grouped[id] ??= []).push(bounds);
      };
      for (const part of furniture.parts) add(part.id, part.bounds);
      if (options.background !== false)
        for (const [id, item] of Object.entries(staging.objects))
          if (item.kind === 'door')
            for (const part of furnitureParts(item, staging.projection, frames.objects[id] ?? 0))
              add(id, part.bounds);
      const itemBounds = (b: ItemFrame) =>
        'portable' in b ? portableBounds(b, staging.objects[b.id]!.art!) : bookBounds(b);
      const held = new Set(Object.values(heldItems).map((b) => b.id));
      for (const b of Object.values(itemFrames))
        if (options.background !== false || held.has(b.id)) add(b.id, itemBounds(b));
      for (const id of Object.keys(options.surfaces ?? {})) {
        const object = staging.objects[id]!;
        const held = Object.values(heldItems).find((b) => b.id === id);
        if (options.background === false && !held) continue;
        const frame = itemFrames[id];
        const quad =
          object.kind === 'book'
            ? frame && !('portable' in frame)
              ? bookContent(frame)
              : undefined
            : drawingPlane(object, staging.projection, frames.items[id] ?? object.at, held).quad;
        if (quad) {
          const x = Math.min(...quad.map((p) => p.x)),
            y = Math.min(...quad.map((p) => p.y));
          add(`${id}.content`, {
            x,
            y,
            width: Math.max(...quad.map((p) => p.x)) - x,
            height: Math.max(...quad.map((p) => p.y)) - y,
          });
        }
      }
      return Object.fromEntries(Object.entries(grouped).map(([id, boxes]) => [id, union(boxes)]));
    },
    restingBook(id: string) {
      const item = staging.objects[id];
      if (!item || item.kind !== 'book' || Object.values(heldItems).some((b) => b.id === id))
        return undefined;
      return { ...item, at: frames.items[id] ?? item.at, open: frames.objects[id] ?? 0 };
    },
    snapshot: () => ({
      actors: Object.fromEntries(Object.entries(bodies).map(([id, b]) => [id, b.snapshot()])),
      items: structuredClone(heldItems),
      objects: { ...frames.objects },
    }),
    controls: () => frames.objects,
    dispose() {
      for (const body of Object.values(bodies)) body.dispose();
      props?.dispose();
      furniture.dispose();
    },
  };
}
