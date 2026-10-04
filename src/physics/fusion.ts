import { fusionSurface, type FusionFrame, type FusionOptions } from '../ink/fusion/surface.js';
import type { FusionShape } from '../ink/fusion/shape.js';
import { world2D } from './world2d.js';
import { fusionTrack } from './fusion-track.js';
import { positive } from './materials.js';

export interface PhysicalFusionOptions extends FusionOptions {
  duration: number;
  /** A deterministic pose and morph at any time within the duration. */
  frame(time: number): FusionFrame;
  /** Rapier natural frequency in Hz. Higher values make the ink stiffer. */
  softness?: number;
}

/** Rapier owns elasticity; InkFusion owns correspondence and the contact surface. */
export async function physicalFusion(parent: HTMLElement, options: PhysicalFusionOptions) {
  const authoredDuration = positive(options.duration, 'Fusion duration');
  const world = await world2D({ gravity: [0, 0] });
  let surface: ReturnType<typeof fusionSurface>;
  try {
    surface = fusionSurface(parent, options);
  } catch (error) {
    world.dispose();
    throw error;
  }
  let track: ReturnType<typeof fusionTrack> | undefined,
    motion: ReturnType<typeof surface.setShapes> | undefined,
    duration = authoredDuration,
    disposed = false;
  const frameAt = (time: number, seconds = duration) =>
    options.frame((time / seconds) * authoredDuration);
  const prepareTrack = (compiled: NonNullable<typeof motion>, seconds: number) =>
    fusionTrack(world, compiled, (time) => frameAt(time, seconds), seconds, options.softness);
  return {
    canvas: surface.canvas,
    setSize: surface.setSize,
    get geometry() {
      return surface.geometry;
    },
    onChange: surface.onChange,
    onDispose: surface.onDispose,
    /** Retime the authored path without recomputing its stroke correspondence. */
    setDuration(seconds: number) {
      if (disposed) throw new Error('Fusion surface has been disposed');
      positive(seconds, 'Fusion duration');
      if (seconds === duration) return;
      const next = motion && prepareTrack(motion, seconds);
      track?.dispose();
      track = next;
      duration = seconds;
    },
    setShapes(sources: readonly FusionShape[], targets: readonly FusionShape[]) {
      if (disposed) throw new Error('Fusion surface has been disposed');
      const compiled = surface.setShapes(sources, targets);
      const next = prepareTrack(compiled, duration);
      track?.dispose();
      motion = compiled;
      track = next;
    },
    render(time: number) {
      if (disposed || !track) return;
      time = Math.max(0, Math.min(duration, time));
      const vertices = track.sample(time);
      surface.render(frameAt(time), vertices);
    },
    get stats() {
      return track?.stats;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      track?.dispose();
      motion = undefined;
      world.dispose();
      surface.dispose();
    },
  };
}
