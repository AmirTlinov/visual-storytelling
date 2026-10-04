/** Read one output from the real full projection and expose its first four contributions. */
export function projectionBreakdown(data, selected, token) {
  const [i, j, h] = selected.split('-').map(Number);
  const inputs = data.inputs[token];
  const weights = data.parameters.values[h].map((row) => row[j]);
  const terms = inputs.map((x, k) => x * weights[k]);
  const partial = terms.reduce((sum, value) => sum + value, 0);
  const output = data.queries[h][token][j];
  // The full output is supplied by BERT. This remainder keeps all 252 hidden inputs and bias.
  return { i, j, h, inputs, weights, terms, partial, rest: output - partial, output };
}
export function decimal(value, digits = 3) {
  return (Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value).toFixed(digits).replace('-', '−');
}
export function weightColor(value, limit, surface = 'var(--ve-surface)') {
  const amount = 52 * Math.min(1, Math.abs(value) / limit);
  return `color-mix(in srgb,var(--ve-${value < 0 ? 'orange' : 'blue'}) ${amount}%,${surface})`;
}
export function escapeXML(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c],
  );
}
