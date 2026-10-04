import {
  ManagedWebGLRenderingContext,
  SceneRenderer,
  GLTexture,
} from '@esotericsoftware/spine-webgl';
import { unpackCharacter, readSkeleton } from './performance.js';
import type { CharacterPack } from './types.js';

/** One context and atlas for every chapter. A cut changes stage state, never the graphics owner. */
export async function characterRenderer(pack: CharacterPack) {
  const source = await unpackCharacter(pack);
  const images = new Map(
    await Promise.all(
      Object.entries(source.textures).map(async ([name, url]) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        return [name, image] as const;
      }),
    ),
  );
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
    const maxTextureSize = context.gl.getParameter(context.gl.MAX_TEXTURE_SIZE) as number;
    for (const page of atlas.pages) {
      const image = images.get(page.name);
      if (!image) throw new Error(`Missing character atlas page: ${page.name}`);
      if (image.width > maxTextureSize || image.height > maxTextureSize)
        throw new Error(
          `Character atlas page exceeds this GPU's ${maxTextureSize}px texture limit: ${page.name}`,
        );
      page.setTexture(new GLTexture(context, image, false));
    }
    return {
      canvas,
      context,
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
