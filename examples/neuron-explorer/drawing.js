import { rough } from '@visual-storytelling/core';
import { compute } from './model.js';
export function drawing(svg, node, values) {
  const rc = rough.svg(svg),
    { terms, sum, output } = compute(values),
    hits = [];
  const text = (x, y, value, color = 'ink', size = 23) =>
    `<text x="${x}" y="${y}" fill="var(--ve-${color})" font-size="${size}" text-anchor="middle" dominant-baseline="middle">${value}</text>`;
  const rect = (x, y, w, h, color, seed) =>
    rc.rectangle(x, y, w, h, {
      seed,
      roughness: 0.35,
      bowing: 0.4,
      disableMultiStroke: true,
      stroke: `var(--ve-${color})`,
      strokeWidth: 1.6,
      fill: `var(--ve-${color}-wash)`,
      fillStyle: 'solid',
    }).outerHTML;
  const target = (id, label, x, y, w, h, content, color = 'blue') => {
    hits.push({ key: id, label, node: { id, label }, box: { x, y, w, h } });
    return `<g data-part="${id}">${rect(x, y, w, h, color, id.length * 71)}${content}</g>`;
  };
  let body = '',
    caption = '';
  if (node.id === 'neuron') {
    body = text(300, 38, `${values.a} × 3 + ${values.b} × 4 ≥ ${values.threshold}`, 'ink', 26);
    body += target(
      'sum',
      'Взвешенная сумма',
      50,
      100,
      245,
      150,
      text(172, 158, sum, 'purple', 44) + text(172, 215, 'сумма', 'purple', 18),
      'purple',
    );
    body += target(
      'threshold',
      'Порог',
      345,
      100,
      205,
      150,
      text(447, 153, `≥ ${values.threshold}`, 'green', 34) +
        text(447, 214, `выход: ${output}`, 'green', 22),
      'green',
    );
    body += rc.line(302, 175, 334, 175, {
      seed: 31,
      roughness: 0.35,
      stroke: 'var(--ve-ink)',
    }).outerHTML;
    caption = 'Открой сумму или порог. Изменяй входы: все уровни показывают одно вычисление.';
  } else if (node.id === 'sum') {
    body = text(300, 45, `${terms[0]} + ${terms[1]} = ${sum}`, 'purple', 32);
    body += target(
      'term-0',
      'Первое произведение',
      50,
      100,
      220,
      150,
      text(160, 151, `${values.a} × 3`, 'blue', 34) + text(160, 213, `= ${terms[0]}`, 'blue'),
      'blue',
    );
    body += target(
      'term-1',
      'Второе произведение',
      330,
      100,
      220,
      150,
      text(440, 151, `${values.b} × 4`, 'orange', 34) + text(440, 213, `= ${terms[1]}`, 'orange'),
      'orange',
    );
    caption =
      'Каждый вход умножается на свой вес. Открой произведение, чтобы увидеть его слагаемые.';
  } else if (node.id.startsWith('term-')) {
    const index = Number(node.id.slice(-1)),
      value = index ? values.b : values.a,
      weight = index ? 4 : 3,
      color = index ? 'orange' : 'blue';
    body = text(300, 42, `${value} × ${weight} = ${terms[index]}`, color, 32);
    for (let column = 0; column < weight; column++) {
      const x = 80 + column * 125;
      body += rect(x - 40, 100, 85, 150, color, 40 + column);
      for (let i = 0; i < value; i++)
        body += rc.circle(x + 2, 124 + i * 30, 13, {
          seed: 90 + column * 10 + i,
          roughness: 0.25,
          stroke: `var(--ve-${color})`,
          fill: `var(--ve-${color}-wash)`,
          fillStyle: 'solid',
        }).outerHTML;
      body += text(x + 2, 278, value, color, 23);
    }
    caption = `${weight} группы по ${value}: ${Array(weight).fill(value).join(' + ')} = ${terms[index]}.`;
  } else {
    body = text(300, 92, `${sum} ≥ ${values.threshold}`, output ? 'green' : 'red', 48);
    body +=
      rect(175, 160, 250, 95, output ? 'green' : 'red', 97) +
      text(300, 208, `выход = ${output}`, output ? 'green' : 'red', 32);
    caption = output
      ? 'Сумма достигла порога: нейрон выдаёт 1.'
      : 'Сумма меньше порога: нейрон выдаёт 0.';
  }
  return { box: { x: 0, y: 0, w: 600, h: 330 }, body, hits, caption };
}
