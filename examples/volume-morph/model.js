import timing from './timeline.json' with { type: 'json' };

const ease = (p) => {
  const t = Math.max(0, Math.min(1, p));
  return t * t * (3 - 2 * t);
};
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

export function shapeFrame(index, progress) {
  const p = Math.max(0, Math.min(1, progress));
  if (index === 0) return { sources: [{}], targets: [{}], morph: ease(p), tension: 0 };
  const approach = ease(p / 0.3),
    contact = ease((p - 0.3) / 0.18),
    morph = ease((p - 0.3) / 0.7);
  // Approach preserves the rigid sources. Morphing starts when their faces meet.
  const distance = 1.55 - 0.975 * approach - 0.025 * contact;
  return {
    sources: [{ position: [-distance, 0, 0] }, { position: [distance, 0, 0] }],
    targets: [{}],
    morph,
    tension: (index === 1 ? 0.12 : 0.6) * contact,
  };
}
