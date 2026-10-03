export * as ThreeKit from './engine.js';
export { Viewport3D } from './three.js';
export type { Shot3D, ShotTransition3D } from './shots.js';
export type { LabelOptions, Face, FaceAnchor } from './labels.js';
export { arrangeTensorRows, deliverTensorCells, calculateTensorColumns } from './tensor-motion.js';
export type { TensorCell, TensorHandle, Point3 } from './tensor-motion.js';
export { readableFrame, geometryFrameAnchors } from './framing.js';
export type { FrameAnchor, ReadableFrame } from './framing.js';

export type { Viewport } from './three.js';
export { cameraTrack } from './camera.js';
export type { CameraShot } from './camera.js';
export type { ConnectionOptions } from './connections.js';
export { TensorData, formatNumber } from '../math/tensor-data.js';
export { TensorView } from '../math/tensor.js';
export { vectorOperation, operationState } from '../math/operation.js';
export type { TensorOptions } from '../math/tensor.js';
export type { OperationOptions, VectorOperation } from '../math/operation.js';
export { tensorSlice } from '../math/slice.js';
