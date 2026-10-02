export interface ExplorerPoint {
  x: number;
  y: number;
}
export interface Bounds extends ExplorerPoint {
  w: number;
  h: number;
}
export interface CameraPose extends ExplorerPoint {
  s: number;
}
export interface ExplorerTarget<N = unknown> {
  key: string;
  label: string;
  node: N;
  box: Bounds;
}
export interface ExplorerScene<N = unknown> {
  body: string;
  box: Bounds;
  hits: ExplorerTarget<N>[];
}
