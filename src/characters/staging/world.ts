import type { ManagedWebGLRenderingContext, SceneRenderer } from '@esotericsoftware/spine-webgl';
import type { CharacterStageOptions } from '../types.js';
import type { performance } from '../performance.js';
import type { Blocking } from './blocking.js';
import { blockAt } from './motion.js';
import { body, connect } from './pose.js';
import { drawFurniture, furnitureParts, loadFurniture, color } from './furniture.js';
import { drawBook, type BookFrame } from './book.js';
import { project } from './space.js';
import { union, type FrameBox } from './camera.js';

type Performer = ReturnType<typeof performance>;
/** Prepared world shares the existing cast renderer and absolute story time. */
export async function world(
  options: CharacterStageOptions,
  blocking: Blocking,
  actors: Record<string, Performer>,
  context: ManagedWebGLRenderingContext,
) {
  const { staging } = blocking,
    { height } = options.set;
  const furniture = await loadFurniture(
    context,
    options.background === false ? {} : staging.objects,
    staging.projection,
  );
  const bodies = Object.fromEntries(
    Object.entries(actors).map(([id, perf]) => [
      id,
      body(perf, options.cast[id]!, options.pack.rig!, staging.projection, height),
    ]),
  );
  let books: Record<string, BookFrame> = {},
    frames = blockAt(blocking, 0);
  return {
    sample(time: number, reduced: boolean) {
      frames = blockAt(blocking, time, reduced);
      books = {};
      const actions = Object.fromEntries(
        Object.entries(bodies).map(([id, b]) => [id, b.sample(time, frames.actors[id]!, reduced)]),
      );
      for (const pair of frames.pairs) connect(bodies, pair);
      for (const [id, b] of Object.entries(bodies)) {
        const transfer = b.frame.transfer,
          bookId = transfer?.id ?? b.frame.book;
        if (bookId) {
          const item = staging.objects[bookId]!,
            target = transfer && project(staging.projection, transfer.at);
          books[id] = b.book(
            bookId,
            item.color ?? '#855057',
            transfer && target
              ? {
                  x: target.x,
                  y: target.y,
                  scale: target.scale * (item.scale ?? 0.72),
                  weight: transfer.taking ? 1 - transfer.progress : transfer.progress,
                  grip: transfer.grip,
                }
              : undefined,
          );
        }
      }
      return actions;
    },
    draw(renderer: SceneRenderer) {
      const items: { depth: number; draw: () => void }[] = furniture.parts.map((part) => ({
        depth: part.depth,
        draw: () => {
          const b = part.bounds;
          renderer.drawTexture(part.texture, b.x, height - b.y - b.height, b.width, b.height);
        },
      }));
      if (options.background !== false)
        for (const [id, item] of Object.entries(staging.objects))
          if (item.kind === 'door')
            for (const part of furnitureParts(item, staging.projection, frames.objects[id] ?? 0))
              items.push({ depth: part.depth, draw: () => drawFurniture(renderer, part, height) });
      const held = new Set(Object.values(books).map((b) => b.id));
      if (options.background !== false)
        for (const [id, at] of Object.entries(frames.books))
          if (!held.has(id)) {
            const item = staging.objects[id]!,
              p = project(staging.projection, at),
              book = {
                id,
                x: p.x,
                y: p.y,
                scale: p.scale * (item.scale ?? 0.72),
                turn: 0,
                open: 0,
                handTurn: 0,
                color: item.color ?? '#855057',
              };
            items.push({ depth: at.z - 0.01, draw: () => drawBook(renderer, book, height) });
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
              const shadow = color('#344f47', 0.22);
              for (let i = 0; i < 32; i++)
                renderer.triangle(
                  true,
                  at.x,
                  height - at.y,
                  ps[i * 2]!,
                  ps[i * 2 + 1]!,
                  ps[((i + 1) % 32) * 2]!,
                  ps[((i + 1) % 32) * 2 + 1]!,
                  shadow,
                  shadow,
                  shadow,
                );
            }
            const skeleton = b.perf.skeleton,
              book = books[id];
            if (book) {
              const order = skeleton.drawOrder.appliedPose,
                torso = order.findIndex((slot) => slot.data.name === options.pack.rig!.bodySlot),
                arms = order
                  .map((slot, index) =>
                    options.pack.rig!.frontArms.includes(slot.data.name) ? index : -1,
                  )
                  .filter((index) => index >= 0),
                index = arms.find((index) => index > torso) ?? arms[0] ?? -1;
              if (index > 0) renderer.drawSkeleton(skeleton, -1, order[index - 1]!.data.index);
              drawBook(renderer, book, height);
              renderer.drawSkeleton(skeleton, index < 0 ? -1 : order[index]!.data.index, -1);
            } else renderer.drawSkeleton(skeleton);
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
      const bookBounds = (b: BookFrame) => ({
        x: b.x - 89 * b.scale,
        y: b.y - 99 * b.scale,
        width: 178 * b.scale,
        height: 129 * b.scale,
      });
      const held = new Set(Object.values(books).map((b) => b.id));
      for (const b of Object.values(books)) add(b.id, bookBounds(b));
      if (options.background !== false)
        for (const [id, at] of Object.entries(frames.books))
          if (!held.has(id)) {
            const p = project(staging.projection, at);
            add(
              id,
              bookBounds({
                id,
                x: p.x,
                y: p.y,
                scale: p.scale * (staging.objects[id]!.scale ?? 0.72),
                turn: 0,
                open: 0,
                handTurn: 0,
                color: '',
              }),
            );
          }
      return Object.fromEntries(Object.entries(grouped).map(([id, boxes]) => [id, union(boxes)]));
    },
    snapshot: () => ({
      actors: Object.fromEntries(Object.entries(bodies).map(([id, b]) => [id, b.snapshot()])),
      books: structuredClone(books),
    }),
    dispose: furniture.dispose,
  };
}
