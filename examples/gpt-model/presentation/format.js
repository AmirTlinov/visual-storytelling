export const fmt = (v, digits = 2) =>
  (Math.abs(v) < 0.5 * 10 ** -digits ? 0 : Number(v)).toFixed(digits).replace('-', '−');
export const percent = (v) =>
  v < 0.0001 ? '<0,01%' : `${(v * 100).toFixed(v < 0.01 || v > 0.99 ? 2 : 1).replace('.', ',')}%`;
export const tokenName = (token) => (token === '<начало>' ? 'начало' : token);
export const options = (list) => list.map((value) => ({ value, label: String(value) }));
export const parentView = (view) =>
  ['scores', 'projection', 'merge'].includes(view)
    ? 'attention'
    : view === 'logits'
      ? 'output'
      : ['attention', 'norm', 'residual', 'mlp'].includes(view)
        ? 'block'
        : 'overview';
export const perspectives = (view) =>
  ['overview', 'embedding', 'output', 'model', 'norm', 'merge'].includes(view)
    ? ['diagram']
    : ['projection', 'logits'].includes(view)
      ? ['diagram', 'algebra']
      : ['diagram', 'algebra', 'geometry', 'hardware'];
export const kindFor = (view, previous) =>
  view === 'logits'
    ? 'logit'
    : view === 'projection'
      ? 'projection'
      : view === 'mlp'
        ? 'mlp'
        : ['block', 'residual'].includes(view)
          ? 'residual'
          : view === 'attention' && previous === 'mix'
            ? 'mix'
            : 'score';
