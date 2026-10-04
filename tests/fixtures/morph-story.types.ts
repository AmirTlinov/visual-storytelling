import { MorphStory, MathMorph, InkMorph } from '../../src/index.js';

export function checkMorphStoryTypes(root: HTMLElement) {
  const script = { duration: 4, cues: { sum: { start: 0, end: 4 } } };
  MorphStory.mount(root, {
    title: 'Sum',
    presenter: MathMorph,
    initial: { amount: 2 },
    script,
    parameters: [{ key: 'amount', label: 'Amount' }],
    chapters: [{ id: 'sum', operation: (p) => MathMorph.add(p.amount, 3) }],
  });
  MorphStory.mount(root, {
    title: 'Words',
    presenter: InkMorph,
    initial: { text: 'First' },
    script,
    chapters: [{ id: 'sum', operation: (p) => ({ sources: [p.text], targets: ['Next'] }) }],
  });
  MorphStory.mount(root, {
    title: 'Vectors',
    presenter: MathMorph,
    initial: { x: [1, 2], w: [3, 4] },
    script,
    chapters: [{ id: 'sum', operation: (p) => MathMorph.dot(p.x, p.w) }],
  });
  MorphStory.mount(root, {
    title: 'Types',
    presenter: MathMorph,
    initial: { amount: 2 },
    script,
    // @ts-expect-error Controls must refer to a declared input.
    parameters: [{ key: 'missing', label: 'Missing' }],
    chapters: [{ id: 'sum', operation: (p) => MathMorph.add(p.amount, 3) }],
  });
}
