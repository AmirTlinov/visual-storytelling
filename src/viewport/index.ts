export * as ThreeKit from './engine.js';
export { VolumeMorph } from './morph/surface.js';
export type {
  VolumeMorphOptions,
  VolumeShape,
  VolumeFrame,
  VolumePose,
  VolumePoint,
} from './morph/surface.js';
export { Viewport3D } from './three.js';
export { SvgArtwork3D } from './artwork.js';
export { InkStroke3D } from './ink-line.js';
export type { InkStrokeOptions } from './ink-line.js';
export type { SvgArtworkOptions } from './artwork.js';
export type { Viewport3DHandle } from './three.js';
export { SvgOrbit } from './svg-orbit.js';
export type { SvgOrbitPose } from './svg-orbit.js';
export type { Shot3D, ShotTransition3D } from './shots.js';
export type { LabelOptions, LabelInsets, Face } from './labels.js';
export { arrangeTensorRows, deliverTensorCells } from './tensor-motion.js';
export type { TensorCell, TensorHandle, Point3 } from './tensor-motion.js';
export { readableFrame, geometryFrameAnchors } from './framing.js';
export type { FrameAnchor, ReadableFrame } from './framing.js';

export { MathMorph3D } from '../morph/three.js';
export { Morph3D } from '../morph/object-3d.js';
