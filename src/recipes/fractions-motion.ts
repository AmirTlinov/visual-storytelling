import type { MathMorphPlan, MathPart } from '../morph/types.js';
import { partBounds } from '../morph/measure.js';
import { TensorData } from '../math/tensor.js';
import { rationalNumber } from '../math/rational.js';
import { regroup } from './tokens.js';
import type { Point } from '../ink/pen.js';
import type { FractionState } from './fractions-model.js';
export interface FractionPiecePose {
  id: string;
  from: Point;
  to: Point;
  width: number;
  height: number;
  side: 'left' | 'right';
  moving: boolean;
}
/** A MathMorph geometry plan reads already measured parts; Story supplies its only clock. */
export function fractionsMotion(
  state: FractionState,
  pieces: readonly FractionPiecePose[],
): MathMorphPlan<number> {
  const initial = pieces.map((piece) => piece.from);
  const phases: Array<{ from: Point[]; to: Point[] }> = [];
  let position: Point[] = [...initial];
  const change = (target: (piece: FractionPiecePose, index: number) => Point) => {
    const to = pieces.map(target);
    if (
      to.every(
        (point, index) => point[0] === position[index]![0] && point[1] === position[index]![1],
      )
    )
      return;
    phases.push({ from: position, to });
    position = to;
  };
  const overflow = (piece: FractionPiecePose) =>
    piece.moving &&
    piece.side === 'right' &&
    piece.to[1] > pieces.find((candidate) => candidate.moving && candidate.side === 'left')?.to[1]!;
  const overflowing = new Set(pieces.filter(overflow).map((piece) => piece.id));
  // Lower-row material leaves vertically, then horizontally, before other pieces enter its path.
  change((piece, index) =>
    overflowing.has(piece.id) ? [position[index]![0], piece.to[1]] : position[index]!,
  );
  change((piece, index) => (overflowing.has(piece.id) ? piece.to : position[index]!));
  change((piece, index) =>
    piece.moving && piece.side === 'right' && !overflowing.has(piece.id)
      ? [piece.to[0], position[index]![1]]
      : position[index]!,
  );
  change((piece, index) => (piece.moving && piece.side === 'left' ? piece.to : position[index]!));
  change((piece, index) => (piece.moving && piece.side === 'right' ? piece.to : position[index]!));
  const tensor = new TensorData({
    id: `${state.roots[0]!.id}:material`,
    shape: [2],
    values: state.roots.map((root) => rationalNumber(root.amount)),
    axes: ['исходная доля'],
  });
  const parts = (points: readonly Point[]): MathPart[] =>
    pieces.map((piece, index) => {
      const measured = state.parts.find((part) => part.id === piece.id)!;
      return {
        id: piece.id,
        size: [piece.width, piece.height, 1],
        position: [points[index]![0] + piece.width / 2, -points[index]![1] - piece.height / 2, 0],
        value: rationalNumber(measured.amount),
        inputIds: measured.inputs,
        material: piece.side,
        origins: measured.origins.map((origin) => {
          const leaf = state.roots.findIndex((root) => root.id === origin.id);
          const source = tensor.origin(leaf);
          return {
            operand: leaf,
            index: 0,
            value: source.value,
            source,
          };
        }),
        originPrecision: 'exact',
      };
    });
  const all = parts(initial).concat(...phases.map((phase) => parts(phase.to)));
  const bounds = all.length
    ? partBounds(all)
    : ([
        [0, 0, 0],
        [1, 1, 1],
      ] as const);
  return {
    encoding: 'objects',
    measure: 'value',
    result: rationalNumber(state.total),
    bounds,
    stages: Math.max(1, phases.length),
    sample(progress: number) {
      if (!Number.isFinite(progress) || progress < 0 || progress > 1)
        throw new Error('Fraction motion needs progress in[0,1].');
      const index = Math.min(phases.length - 1, Math.floor(progress * phases.length)),
        phase = phases[index];
      const points = phase
        ? regroup(phase.from, phase.to, progress === 1 ? 1 : progress * phases.length - index)
        : initial;
      const current = parts(points);
      return {
        sources: current,
        targets: current,
        morph: 0,
        formula: '',
        phase: progress === 1 ? 'hold' : 'separate',
        stage: Math.max(0, index),
        ...(progress === 1 && { result: rationalNumber(state.total) }),
      };
    },
  };
}
