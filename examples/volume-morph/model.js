import timing from './timeline.json' with { type: 'json' };

export const cases = [
  { id: 'round', title: 'Кубик → шар' },
  { id: 'join', title: 'Два кубика → брусок' },
  { id: 'mixed', title: 'Кубик + шар → капсула' },
];

export function stateAt(frame) {
  const index = frame.has('mixed') ? 2 : frame.has('join') ? 1 : 0;
  const id = cases[index].id;
  const p = frame.progress(`${id}_shape`);
  const start = index ? timing.cues[`${id}_approach`].start : 0;
  const approach = index
    ? Math.max(0, Math.min(1, (frame.time - start) / (timing.cues[`${id}_shape`].start - start)))
    : 0;
  const progress = index ? (frame.has(`${id}_shape`) ? 0.3 + p * 0.7 : approach * 0.3) : p;
  return { index, progress: frame.reduced ? (frame.finished(`${id}_shape`) ? 1 : 0) : progress };
}
