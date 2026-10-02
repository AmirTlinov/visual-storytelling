const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const R = (x, y, w, h, c = 'paper outline', rx = 2) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" class="${c}"/>`;
const P = (d, c = 'line') => `<path d="${d}" class="${c}"/>`;
const C = (x, y, r, c = 'paper outline') => `<circle cx="${x}" cy="${y}" r="${r}" class="${c}"/>`;
const G = (name, body, transform = '') =>
  `<g data-part="${name}"${transform ? ` transform="${transform}"` : ''}>${body}</g>`;
const repeat = (n, fn) => Array.from({ length: n }, (_, i) => fn(i)).join('');
const pin = (x, y, w, h) =>
  R(x, y, w, h, 'gold fine', 0.6) +
  P(
    w > h ? `M ${x + 1.2} ${y + 1.3} h ${w - 2.4}` : `M ${x + 1.3} ${y + 1.2} v ${h - 2.4}`,
    'edge',
  );
const via = (x, y) => C(x, y, 1.5, 'gold') + C(x, y, 0.65, 'chip');
const passive = (x, y, w = 8, h = 4) =>
  G('capacitor', R(x, y, w, h, 'metal fine', 0.4) + R(x + 1.7, y, w - 3.4, h, 'gold', 0));

function cpuDie({ T, unified = false }) {
  let b = R(124, 66, 114, 112, 'chip outline', 2) + R(127, 69, 108, 106, 'die-dark fine', 1);
  b += repeat(2, (row) =>
    repeat(3, (col) => {
      const x = 132 + col * 34,
        y = 74 + row * 37;
      let core = R(x, y, 27, 29, 'die fine', 1) + R(x + 2, y + 2, 23, 11, 'chip', 0.4);
      core += P(`M ${x + 4} ${y + 16} l 9 2 v 6 l -9 2 v -4 l 2 -1 l -2 -2 Z`, 'metal-hi');
      core += repeat(3, (i) => R(x + 16, y + 16 + i * 3, 7, 1.7, 'metal-hi', 0.2));
      return G(`core-${row * 3 + col}`, core) + T(x + 13.5, y + 8, `C${row * 3 + col}`, 11, 'etch');
    }),
  );
  b += P('M 145 105 V 109 H 218 V 105 M 145 142 V 146 H 218 V 142 M 179 146 V 150', 'trace');
  b +=
    G(
      'cache',
      R(132, 150, 95, 18, 'metal-hi', 1) +
        repeat(8, (i) => P(`M ${135 + i * 11.5} 153 v 12`, 'engraving')),
    ) + T(179, 159, 'КЭШ', 11);
  if (unified)
    b +=
      P('M 180 168 V 184', 'trace') +
      G('memory', R(132, 184, 95, 14, 'metal fine', 1)) +
      T(179, 191, 'ОБЩАЯ ПАМЯТЬ', 11);
  return { body: G('die', b) };
}

function cpuPackage(ctx) {
  const { T, mini, inside } = ctx;
  let pins = repeat(
    11,
    (i) =>
      pin(118 + i * 12, 35, 5, 17) +
      pin(118 + i * 12, 190, 5, 17) +
      pin(95, 56 + i * 12, 17, 5) +
      pin(250, 56 + i * 12, 17, 5),
  );
  let base = P('M 112 48 H 250 L 258 56 V 188 L 250 196 H 112 L 104 188 V 56 Z', 'board outline');
  base += P('M 111 57 V 184 L 117 190 H 249', 'trace') + P('M 113 52 H 247 L 254 59 V 185', 'edge');
  base += P('M 112 180 V 186 H 118', 'line');
  if (!mini) {
    base += repeat(5, (i) => passive(114 + i * 10, 55, 7, 3) + passive(207 + i * 8, 187, 5.5, 3));
    base += repeat(8, (i) => via(110, 67 + i * 13) + via(251, 65 + i * 13));
    base += repeat(
      5,
      (i) =>
        P(`M ${171 + i * 12} 52 v 6 l 5 5`, 'micro') +
        P(`M ${128 + i * 13} 191 v -6 l -4 -4`, 'micro'),
    );
  }
  let die;
  if (inside) {
    die = cpuDie(ctx).body;
  } else {
    die = P(
      'M 131 65 H 231 V 72 H 240 V 101 H 235 V 143 H 240 V 171 H 231 V 179 H 131 V 171 H 122 V 143 H 127 V 101 H 122 V 73 H 131 Z',
      'metal outline',
    );
    die += P('M 138 73 H 224 L 231 80 V 165 H 225 V 172 H 138 L 131 165 V 81 Z', 'metal-hi fine');
    die += T(181, 119, 'CPU', 23);
    if (!mini)
      die +=
        P('M 156 143 H 207 M 162 148 H 201 M 162 153 H 188', 'fine') +
        P('M 143 87 h 8 l -8 8 Z', 'gold') +
        P('M 134 96 V 82 L 141 76 H 219', 'edge');
  }
  return {
    body: G('contacts', pins) + G('substrate', base) + G('die', die),
    ports: [
      { x: 95, y: 122, dx: -23, dy: 0, label: 'BUS' },
      { x: 181, y: 207, dx: 0, dy: 19, label: 'CLK' },
    ],
  };
}
function gpuDie({ T, mini = false, inside = false, unified = false }) {
  let die =
    R(107, 55, 146, 124, 'chip outline', 2) +
    R(112, 60, 136, 114, 'metal fine', 1) +
    R(116, 64, 128, 106, 'die-dark fine', 0.5);
  die +=
    R(120, 68, 120, 12, 'metal-hi', 0.5) +
    T(180, 74, inside ? (unified ? 'GPU · ВЫЧИСЛЕНИЯ' : 'SM · ВЫЧИСЛЕНИЯ') : 'GPU', 11);
  die += repeat(2, (r) =>
    repeat(4, (c) => {
      const x = 120 + c * 31,
        y = 84 + r * 24;
      let cluster = R(x, y, 27, 20, 'die', 0.5);
      cluster += inside
        ? R(x + 3, y + 2, 21, 7, 'metal-hi', 0.3) +
          T(x + 13.5, y + 5.5, `${unified ? 'G' : 'SM'}${r * 4 + c}`, 5)
        : repeat(2, (i) => R(x + 3 + i * 12, y + 3, 9, 5, 'metal-hi', 0.3));
      cluster += R(x + 3, y + 12, 21, 4, 'chip', 0.3);
      if (!mini) cluster += repeat(3, (i) => R(x + 4 + i * 7, y + 13, 4, 2, 'metal-hi', 0.2));
      return G(`sm-${r * 4 + c}`, cluster);
    }),
  );
  die += G('l2', R(120, 134, 120, 14, 'metal-hi', 0.5)) + T(180, 141, 'L2', 11);
  die +=
    G('memory', R(120, 153, unified ? 120 : 76, 12, 'die', 0.5)) +
    T(unified ? 180 : 158, 159, unified ? 'FABRIC' : 'GDDR', 8);
  if (!unified) die += G('display', R(202, 153, 38, 12, 'metal-hi', 0.5)) + T(221, 159, 'DISP', 5);
  if (!mini) die += P('M 114 63 H 245 V 171', 'edge');
  return { body: G('die', die) };
}
function gpuPackage(ctx) {
  const { mini } = ctx;
  let substrate = P(
    'M 88 25 H 272 L 281 34 V 207 L 272 216 H 88 L 79 207 V 34 Z',
    'shadow outline',
  );
  substrate += P('M 88 22 H 272 L 281 31 V 203 L 272 212 H 88 L 79 203 V 31 Z', 'board outline');
  substrate += P('M 91 29 H 268 L 274 35 V 198 L 267 205 H 92 L 86 198 V 35 Z', 'trace');
  substrate += P('M 86 188 v 12 h 12', 'edge') + P('M 89 195 h 6 l -6 6 Z', 'gold');
  if (!mini) {
    substrate += repeat(11, (i) => via(93 + i * 17, 33) + via(93 + i * 17, 199));
    substrate += repeat(9, (i) => via(88, 47 + i * 17) + via(272, 47 + i * 17));
    substrate += repeat(
      10,
      (i) => passive(102 + i * 15, 42, 8, 4) + passive(102 + i * 15, 185, 8, 4),
    );
    substrate += repeat(
      7,
      (i) =>
        G('side-decoupling', passive(0, 0, 9, 4), `translate(94 ${58 + i * 17}) rotate(90)`) +
        G('side-decoupling', passive(0, 0, 9, 4), `translate(268 ${58 + i * 17}) rotate(90)`),
    );
    substrate += repeat(9, (i) =>
      P(`M ${106 + i * 17} 47 v 4 l 5 5 v 6 M ${106 + i * 17} 185 v -4 l 5 -5 v -5`, 'micro'),
    );
    substrate += repeat(7, (i) =>
      P(`M 97 ${62 + i * 17} h 5 l 6 5 h 5 M 263 ${62 + i * 17} h -5 l -6 5 h -5`, 'micro'),
    );
  } else
    substrate += repeat(
      8,
      (i) => R(106 + i * 19, 42, 9, 4, 'gold', 0.4) + R(106 + i * 19, 187, 9, 4, 'gold', 0.4),
    );
  return {
    body: G('gpu-substrate', substrate) + gpuDie(ctx).body,
    ports: [
      { x: 79, y: 121, dx: -23, dy: 0, label: 'PCIe' },
      { x: 281, y: 121, dx: 23, dy: 0, label: 'VRAM' },
    ],
  };
}
function ram(ctx) {
  const { T, inside, mini } = ctx;
  if (inside) {
    let b = P('M 82 62 H 297 V 176 H 82 Z', 'board outline');
    b += P('M 51 79 L 74 62 V 176 L 51 159 Z', 'metal outline');
    b += repeat(6, (row) => P(`M 74 ${74 + row * 18} H 290`, 'trace'));
    b += repeat(8, (col) => P(`M ${95 + col * 26} 56 V 188`, 'trace'));
    b += repeat(6, (row) =>
      repeat(8, (col) =>
        R(88 + col * 26, 67 + row * 18, 14, 12, row === 2 ? 'die fine' : 'paper fine', 1),
      ),
    );
    b += T(184, 207, 'СТРОКИ × СТОЛБЦЫ', 12);
    return {
      body: G('memory-array', b),
      ports: [
        { x: 51, y: 117, dx: -25, dy: 0, label: 'ADDR' },
        { x: 184, y: 188, dx: 0, dy: 29, label: 'DATA' },
      ],
    };
  }
  let b = P(
    'M 40 79 H 320 V 103 H 314 V 114 H 320 V 162 H 305 V 179 H 190 V 164 H 177 V 179 H 56 V 162 H 40 V 113 H 46 V 102 H 40 Z',
    'board outline',
  );
  b += repeat(31, (i) => {
    const x = 62 + i * 7.7;
    return x > 173 && x < 194 ? '' : pin(x, 161, 5.3, 16);
  });
  if (!mini) b += repeat(30, (i) => P(`M ${65 + i * 7.6} 153 v 3 l -2 3 v 2`, 'micro'));
  b += repeat(8, (i) => {
    const x = 53 + i * 32;
    let chip =
      R(x, 99, 25, 47, 'chip fine', 1) + P(`M ${x + 2} 142 V 102 H ${x + 22}`, 'engraving');
    if (!mini)
      chip += C(x + 4, 138, 1, 'metal') + repeat(4, (j) => passive(x + 3 + j * 5, 150, 4, 2.4));
    chip += P(
      `M ${x + 5} 109 h 15 M ${x + 5} 113 h 11 M ${x + 5} 122 h 15 M ${x + 5} 126 h 8`,
      'engraving',
    );
    return G(`chip-${i}`, chip);
  });
  if (!mini)
    b +=
      repeat(14, (i) => passive(57 + i * 18, 86, 8, 4)) + repeat(12, (i) => via(64 + i * 20, 94));
  b += C(48, 88, 2.5, 'paper fine') + C(312, 88, 2.5, 'paper fine');
  return {
    body: G('ram-module', b),
    ports: [
      { x: 125, y: 179, dx: 0, dy: 28, label: 'BUS' },
      { x: 248, y: 179, dx: 0, dy: 28, label: 'DATA' },
    ],
  };
}
function memoryCell(ctx) {
  const { T } = ctx;
  let b = P('M 98 90 H 143 M 239 90 H 261 V 153 H 215 M 121 153 H 98 V 90');
  b +=
    G(
      'inverter-a',
      P('M 143 72 L 179 90 L 143 108 Z', 'paper outline') + C(184, 90, 5, 'paper outline'),
    ) + P('M 189 90 H 261');
  b +=
    G(
      'inverter-b',
      P('M 215 135 L 179 153 L 215 171 Z', 'paper outline') + C(174, 153, 5, 'paper outline'),
    ) + P('M 169 153 H 98');
  b += P('M 44 61 V 184 M 316 61 V 184 M 70 41 H 290 M 70 41 V 108 M 290 41 V 108');
  b += G('access-a', P('M 44 121 H 58 V 112 M 82 112 V 121 H 98 M 58 112 H 82 M 58 108 H 82'));
  b += G(
    'access-b',
    P('M 261 121 H 278 V 112 M 302 112 V 121 H 316 M 278 112 H 302 M 278 108 H 302'),
  );
  b +=
    C(98, 121, 2.7, 'dot') +
    C(261, 121, 2.7, 'dot') +
    C(44, 121, 2.7, 'dot') +
    C(316, 121, 2.7, 'dot');
  b += T(44, 48, 'BL', 12) + T(316, 48, 'BL̅', 12) + T(180, 27, 'WL', 12) + T(180, 214, '1 БИТ', 12);
  return {
    body: G('sram-cell', b),
    ports: [
      { x: 44, y: 61, dx: 0, dy: -14, label: 'BL' },
      { x: 316, y: 61, dx: 0, dy: -14, label: 'BL̅' },
      { x: 180, y: 41, dx: 0, dy: -18, label: 'WL' },
    ],
  };
}
function gate(ctx, kind) {
  const { T } = ctx;
  let b;
  const ports = [];
  const left = 122,
    top = 72,
    bottom = 168;
  if (kind === 'and' || kind === 'nand') {
    b = P(`M ${left} ${top} H 169 A 48 48 0 0 1 169 ${bottom} H ${left} Z`, 'paper outline');
    b += P('M 77 96 H 122 M 77 144 H 122');
    if (kind === 'nand') b += C(224, 120, 7, 'paper outline') + P('M 231 120 H 283');
    else b += P('M 217 120 H 283');
  } else if (kind === 'or' || kind === 'xor' || kind === 'nor') {
    b = P('M 117 72 Q 184 69 235 120 Q 184 171 117 168 Q 151 120 117 72 Z', 'paper outline');
    if (kind === 'xor') b += P('M 105 72 Q 139 120 105 168');
    b += P('M 77 96 H 129.75 M 77 144 H 129.75');
    b +=
      kind === 'nor'
        ? C(242, 120, 7, 'paper outline') + P('M 249 120 H 283')
        : P('M 235 120 H 283');
  } else if (kind === 'not') {
    b =
      P('M 129 70 L 220 120 L 129 170 Z', 'paper outline') +
      C(227, 120, 7, 'paper outline') +
      P('M 77 120 H 129 M 234 120 H 283');
  } else if (kind === 'mux') {
    b = P('M 136 58 L 217 84 V 156 L 136 182 Z', 'paper outline');
    b += repeat(4, (i) => P(`M 77 ${78 + i * 28} H 136`));
    b += P('M 217 120 H 283 M 175 170 V 203');
    b += T(175, 119, 'MUX', 18) + T(192, 199, 'S', 12);
    ports.push({ x: 175, y: 203, dx: 0, dy: 0, label: 'S' });
  } else throw new Error(`Unknown logic symbol: ${kind}`);
  if (kind === 'not') {
    b += T(88, 101, 'A', 12);
    ports.push({ x: 77, y: 120, dx: 0, dy: 0, label: 'A' });
  } else if (kind === 'mux') {
    for (let i = 0; i < 4; i++) ports.push({ x: 77, y: 78 + i * 28, dx: 0, dy: 0, label: `D${i}` });
  } else {
    b += T(89, 79, 'A', 12) + T(89, 161, 'B', 12);
    ports.push(
      { x: 77, y: 96, dx: 0, dy: 0, label: 'A' },
      { x: 77, y: 144, dx: 0, dy: 0, label: 'B' },
    );
  }
  b += T(268, 101, 'Y', 12);
  ports.push({ x: 283, y: 120, dx: 0, dy: 0, label: 'Y' });
  return { body: G(kind, b), ports };
}
export {
  C,
  P,
  repeat,
  G,
  pin,
  R,
  passive,
  via,
  cpuPackage,
  gpuPackage,
  memoryCell,
  esc,
  gate,
  ram,
  cpuDie,
  gpuDie,
};
