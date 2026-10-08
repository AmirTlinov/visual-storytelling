import { readCharacter } from './rig.js';
import { characterCompositor } from './compositor.js';
import type { CharacterPack } from './types.js';

/** One GPU context and shared glTF resources across chapter changes. */
export async function characterRenderer(pack: CharacterPack, signal?: AbortSignal) {
  const data = await readCharacter(pack, { signal }),
    canvas = document.createElement('canvas');
  let renderer: ReturnType<typeof characterCompositor> | undefined;
  let active: HTMLElement | undefined,
    disposed = false;
  try {
    signal?.throwIfAborted();
    renderer = characterCompositor(canvas);
    const maxTextureSize = renderer.renderer.capabilities.maxTextureSize;
    for (const page of data.pages) {
      const image = page.image as { width: number; height: number };
      if (image.width > maxTextureSize || image.height > maxTextureSize)
        throw new Error(`Character artwork exceeds this GPU's ${maxTextureSize}px texture limit`);
    }
    return {
      canvas,
      renderer,
      data,
      maxTextureSize,
      activate(element: HTMLElement, front: Element) {
        if (active !== element) {
          if (active) active.hidden = true;
          element.insertBefore(canvas, front);
          active = element;
        }
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        data.dispose();
        renderer?.dispose();
        canvas.width = canvas.height = 1;
        canvas.remove();
      },
    };
  } catch (error) {
    data.dispose();
    renderer?.dispose();
    throw error;
  }
}
export type CharacterRenderer = Awaited<ReturnType<typeof characterRenderer>>;
