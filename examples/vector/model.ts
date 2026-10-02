export interface VectorState {
  x: number;
  y: number;
  a: number;
  b: number;
}
export function transform(state: VectorState) {
  return { x: state.x * state.a, y: state.y * state.b };
}
