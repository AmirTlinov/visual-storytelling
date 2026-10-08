/** Accept only the activation snapshot belonging to this drawing's fixed parameters. */
export function validateProjection(data, reference) {
  const vector = (value) =>
    Array.isArray(value) && value.length === 4 && value.every(Number.isFinite);
  if (
    !data ||
    data.model !== reference.model ||
    data.revision !== reference.revision ||
    data.layer !== reference.layer ||
    typeof data.text !== 'string' ||
    JSON.stringify(data.parameters) !== JSON.stringify(reference.parameters) ||
    !Array.isArray(data.tokens) ||
    !data.tokens.length ||
    !data.tokens.every((token) => typeof token === 'string') ||
    !Array.isArray(data.inputs) ||
    data.inputs.length !== data.tokens.length ||
    !data.inputs.every(vector) ||
    !Array.isArray(data.queries) ||
    data.queries.length !== 4 ||
    !data.queries.every(
      (head) => Array.isArray(head) && head.length === data.tokens.length && head.every(vector),
    )
  )
    throw new Error(
      'Projection must contain finite inputs and outputs from the same BERT parameters',
    );
  return data;
}

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
