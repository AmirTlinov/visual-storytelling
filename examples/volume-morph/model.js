import timing from './timeline.json' with { type: 'json' };

export const cases = [
  { id: 'round', title: 'Кубик → шар' },
  { id: 'join', title: 'Два кубика → брусок' },
  { id: 'mixed', title: 'Кубик + шар → капсула' },
];

// One operation spans the aligned spoken approach and shape cues. Reading and
// result pauses remain outside this interval; the morph owns its contact time.
export const script = {
  ...timing,
  cues: {
    ...timing.cues,
    ...Object.fromEntries(
      cases.map(({ id }) => {
        const approach = timing.cues[`${id}_approach`],
          shape = timing.cues[`${id}_shape`];
        return [
          `${id}_change`,
          {
            start: (approach ?? shape).start,
            end: shape.end,
            text: [approach?.text, shape.text].filter(Boolean).join('. '),
            action: shape.action,
          },
        ];
      }),
    ),
  },
};

export function stateAt(frame) {
  const index = frame.has('mixed') ? 2 : frame.has('join') ? 1 : 0;
  const id = cases[index].id;
  return { index, progress: frame.progress(`${id}_change`) };
}
