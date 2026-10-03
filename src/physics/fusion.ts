import { fusionSurface, type FusionFrame, type FusionOptions } from '../ink/fusion/surface.js';
import type { FusionShape } from '../ink/fusion/shape.js';
import { world2D } from './world2d.js';
import { fusionTrack } from './fusion-track.js';

export interface PhysicalFusionOptions extends FusionOptions {
  duration: number;
  /** A deterministic pose and morph at any time within the duration. */
  frame(time: number): FusionFrame;
  /** Rapier natural frequency in Hz. Higher values make the ink stiffer. */
  softness?: number;
}

/** Rapier owns elasticity; InkFusion owns correspondence and the contact surface. */
export async function physicalFusion(parent: HTMLElement, options: PhysicalFusionOptions) {
  const world = await world2D({ gravity: [0, 0] });
  let surface: ReturnType<typeof fusionSurface>;
  try {
    surface = fusionSurface(parent, options);
  } catch (error) {
    world.dispose();
    throw error;
  }
  let track: ReturnType<typeof fusionTrack> | undefined,
    disposed = false;
  return {
    canvas: surface.canvas,
    setSize: surface.setSize,
    setShapes(first: FusionShape, second: FusionShape, target: FusionShape) {
      if (disposed) throw new Error('Fusion surface has been disposed');
      track?.dispose();
      track = fusionTrack(
        world,
        surface.setShapes(first, second, target),
        options.frame,
        options.duration,
        options.softness,
      );
    },
    render(time: number) {
      if (disposed || !track) return;
      time = Math.max(0, Math.min(options.duration, time));
      const vertices = track.sample(time);
      surface.render(options.frame(time), vertices);
    },
    get stats() {
      return track?.stats;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      track?.dispose();
      world.dispose();
      surface.dispose();
    },
  };
}
