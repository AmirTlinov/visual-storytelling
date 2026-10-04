import {
  ManagedWebGLRenderingContext,
  SceneRenderer,
  GLTexture,
} from '@esotericsoftware/spine-webgl';
import { unpackCharacter, readSkeleton } from './performance.js';
import type { CharacterPack } from './types.js';

/** One context and atlas for every chapter. A cut changes stage state, never the graphics owner. */
export async function characterRenderer(pack: CharacterPack) {
  const source = await unpackCharacter(pack),
    image = new Image();
  image.src = source.texture;
  await image.decode();
  const { atlas, data } = readSkeleton(source),
    canvas = document.createElement('canvas');
  const context = new ManagedWebGLRenderingContext(canvas, {
    alpha: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  });
  let renderer: SceneRenderer | undefined,
    active: HTMLElement | undefined,
    disposed = false;
  try {
    renderer = new SceneRenderer(canvas, context);
    for (const page of atlas.pages) page.setTexture(new GLTexture(context, image, false));
    return {
      canvas,
      context,
      renderer,
      data,
      maxTextureSize: context.gl.getParameter(context.gl.MAX_TEXTURE_SIZE) as number,
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
        atlas.dispose();
        renderer?.dispose();
        context.dispose();
        context.gl.getExtension('WEBGL_lose_context')?.loseContext();
        canvas.width = canvas.height = 1;
        canvas.remove();
      },
    };
  } catch (error) {
    atlas.dispose();
    renderer?.dispose();
    context.dispose();
    context.gl.getExtension('WEBGL_lose_context')?.loseContext();
    throw error;
  }
}
export type CharacterRenderer = Awaited<ReturnType<typeof characterRenderer>>;
