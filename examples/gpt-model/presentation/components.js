import { fmt, tokenName } from './format.js';
export function componentsDrawing(context, components = {}) {
  const { input } = context;
  let measuredSize;
  const widths = new Map();
  const tokenWidth = (d, word) => {
    if (measuredSize !== d.size) {
      widths.clear();
      measuredSize = d.size;
    }
    if (!widths.has(word)) widths.set(word, d.buttonSize(tokenName(word)).width);
    return widths.get(word);
  };
  function tokens(d, s, y, full = true) {
    const gap = d.compact ? 20 : 14,
      all = s.trace.tokens
        .map((word, index) => ({
          word,
          index,
          width: Math.max(
            Math.min(
              d.compact ? 330 : 155,
              (d.width - 80 - (s.trace.tokens.length - (d.compact ? 2 : 1)) * gap) /
                (s.trace.tokens.length - (d.compact ? 1 : 0)),
            ),
            tokenWidth(d, word),
          ),
        }))
        .filter(({ index }) => !d.compact || index > 0),
      span = (items) =>
        items.reduce((sum, item) => sum + item.width, 0) + Math.max(0, items.length - 1) * gap,
      paged = span(all) > d.width - 80,
      available = d.width - 80 - (paged ? 2 * (d.hit + gap) : 0);
    let from = Math.max(
        0,
        all.findIndex(({ index }) => index === s.token),
      ),
      to = from + 1;
    if (!paged) {
      from = 0;
      to = all.length;
    } else {
      while (to < all.length && span(all.slice(from, to + 1)) <= available) to++;
      while (from > 0 && span(all.slice(from - 1, to)) <= available) from--;
    }
    const shown = all.slice(from, to),
      start = (d.width - span(shown)) / 2;
    let x = start;
    shown.forEach(({ word, index, width }) => {
      d.button(`token-${index}`, tokenName(word), x, y, width, () => input({ token: index }), {
        pressed: s.token === index,
        height: d.hit,
        pigment: s.token === index ? 'purple' : 'ink',
        objectId: `${context.current.modelId}:token-${index}`,
        meaning: {
          label: tokenName(word),
          value: () => word,
          provenance: () => ({ model: context.current.modelId, position: index, token: word }),
        },
      });
      x += width + gap;
    });
    if (paged) {
      if (from > 0)
        d.button('tokens-previous', '←', 20, y, d.hit, () => input({ token: all[from - 1].index }));
      if (to < all.length)
        d.button('tokens-next', '→', d.width - d.hit - 20, y, d.hit, () =>
          input({ token: all[to].index }),
        );
    }
    if (!d.compact && full)
      d.text('Каждый токен несёт свой вектор. Выберите любой.', d.width / 2, y + d.hit + 34, {
        anchor: 'middle',
        pigment: 'muted',
        size: 23,
      });
  }
  function vector(
    d,
    values,
    x,
    y,
    w,
    {
      label,
      id = `${context.current.values.view}:${label ?? 'vector'}`,
      pigment = 'ink',
      numbers = true,
      source,
      row = context.current.token,
      offset = 0,
    } = {},
  ) {
    if (label) d.text(label, x, y - 18, { pigment, size: d.size });
    const gap = 5,
      cell = (w - gap * (values.length - 1)) / values.length;
    values.forEach((v, i) => {
      const g = d.box(
        `vector-${label}-${x}-${y}-${i}`,
        x + i * (cell + gap),
        y,
        cell,
        Math.max(cell, d.compact ? 85 : 55),
        pigment,
        'marker',
      );
      g.element.style.setProperty(
        '--ve-wash-strength',
        `${15 + 55 * Math.min(1, Math.abs(v) / 4)}%`,
      );
      d.explain(g.element, `${id}:cell:${i}`, {
        label: `${label ?? 'Вектор'}: координата ${i + 1}`,
        value: () => v,
        implementation: { file: 'model.js' },
        provenance: () =>
          source
            ? { source: { path: source, coordinates: [row, i + offset] }, precision: 'exact' }
            : undefined,
      });
      if (numbers && !d.compact)
        d.text(fmt(v, 1), x + i * (cell + gap) + cell / 2, y + 33, {
          anchor: 'middle',
          size: Math.max(20, d.size),
          pigment,
        });
    });
  }
  return { tokens, vector };
}
