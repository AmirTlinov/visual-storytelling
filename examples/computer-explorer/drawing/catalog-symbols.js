import {
  ram,
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
} from './symbols.js';
const screw = (x, y) =>
  C(x, y, 3, 'metal-hi fine') + P(`M ${x - 1.3} ${y + 1.3} l 2.6 -2.6`, 'line');

function fan(x, y, mini) {
  let s = C(x, y, 43, 'chip outline') + C(x, y, 39, 'metal fine') + C(x, y, 35, 'chip');
  s += repeat(9, (i) => {
    let blade = P('M -3 -10 C -6 -17 -21 -21 -16 -29 C -10 -35 3 -29 7 -20 L 6 -9 Z', 'metal fine');
    if (!mini) blade += P('M -2 -13 C -4 -19 -12 -24 -13 -28', 'edge');
    return G('swept-fan-blade', blade, `translate(${x} ${y}) rotate(${i * 40})`);
  });
  s += C(x, y, 11, 'chip fine') + C(x, y, 8.5, 'metal outline') + C(x, y, 3, 'chip');
  if (!mini)
    s += repeat(4, (i) =>
      G('fan-fastener', C(0, -40.5, 1.2, 'chip'), `translate(${x} ${y}) rotate(${45 + i * 90})`),
    );
  return s;
}

function graphicsCard(ctx) {
  const { T, inside, mini } = ctx;
  let b = P(
    'M 47 66 H 318 L 328 76 V 167 L 318 177 H 284 V 187 H 267 V 196 H 190 V 187 H 178 V 196 H 85 V 178 H 47 Z',
    'board outline',
  );
  b += G(
    'pcie-connector',
    repeat(23, (i) => {
      const x = 91 + i * 7.4;
      return x > 171 && x < 191 ? '' : pin(x, 178, 5.2, 16);
    }),
  );
  b += G(
    'io-bracket',
    P('M 29 50 H 48 V 62 H 40 V 182 H 48 V 196 H 30 V 184 H 34 V 65 H 29 Z', 'metal outline') +
      R(35, 78, 5, 26, 'chip', 1) +
      R(35, 113, 5, 26, 'chip', 1),
  );
  b +=
    R(278, 56, 32, 15, 'chip outline', 1) +
    repeat(2, (r) => repeat(4, (i) => R(282 + i * 6.6, 59 + r * 5, 4, 3.2, 'metal-hi', 0.4)));
  b += P('M 51 69 H 315 L 324 78 M 52 171 H 80 M 289 171 H 315', 'edge');
  if (inside) {
    b += repeat(10, (i) => P(`M ${114 + i * 11} 161 v ${5 + (i % 3) * 2} l 4 4 v 8`, 'micro'));
    b += repeat(6, (i) =>
      P(
        `M ${145 + i * 8} 93 v -9 M ${145 + i * 8} 148 v 9 M 139 ${105 + i * 5} h -15 M 211 ${105 + i * 5} h 15`,
        'micro',
      ),
    );
    const memoryPositions = [
      [135, 73],
      [180, 73],
      [135, 151],
      [180, 151],
      [99, 96],
      [99, 127],
      [226, 96],
      [226, 127],
    ];
    b += G(
      'vram-packages',
      memoryPositions
        .map(
          ([x, y]) =>
            R(x, y, 25, 17, 'chip fine', 1) +
            P(`M ${x + 4} ${y + 5} h 17 M ${x + 4} ${y + 8} h 11`, 'engraving'),
        )
        .join(''),
    );
    b +=
      R(135, 91, 81, 58, 'board fine', 2) +
      R(149, 97, 51, 46, 'metal fine', 1) +
      R(154, 102, 41, 36, 'die-dark', 0.4);
    b += repeat(3, (r) => repeat(4, (c) => R(158 + c * 8.5, 106 + r * 8, 6, 5, 'die', 0.3)));
    b += T(175, 129, 'GPU', 11, 'etch');
    b += repeat(5, (i) => {
      const y = 82 + i * 17;
      return (
        R(267, y, 11, 11, 'chip', 0.6) +
        R(285, y - 1, 20, 13, 'metal fine', 1.5) +
        P(`M 289 ${y + 3} h 12 M 289 ${y + 6} h 12`, 'engraving') +
        passive(254, y + 3, 8, 4)
      );
    });
    b += repeat(
      3,
      (i) =>
        C(65, 89 + i * 27, 7, 'chip fine') +
        C(65, 89 + i * 27, 5.7, 'metal-hi fine') +
        P(`M 62 ${89 + i * 27} h 6 M 65 ${86 + i * 27} v 6`, 'fine'),
    );
    if (!mini)
      b +=
        repeat(7, (i) => via(83, 81 + i * 13) + passive(79, 84 + i * 13, 6, 3)) +
        repeat(5, (i) => passive(145 + i * 12, 87, 7, 3) + passive(145 + i * 12, 147, 7, 3));
    b += screw(55, 74) + screw(319, 79) + screw(54, 168) + screw(315, 166);
  } else {
    b += G(
      'cooler',
      P(
        'M 58 72 H 166 L 184 80 H 311 L 320 88 V 157 L 310 167 H 196 L 178 158 H 58 L 50 150 V 82 Z',
        'metal outline',
      ),
    );
    b += P(
      'M 65 79 H 164 L 183 90 H 305 L 310 95 V 146 L 302 153 H 199 L 180 146 H 65 Z',
      'chip fine',
    );
    if (!mini)
      b += G(
        'heatsink-fins',
        repeat(37, (i) => P(`M ${68 + i * 6.5} 91 V 146`, 'engraving')),
      );
    b += fan(118, 119, mini) + fan(250, 119, mini);
    b += P('M 169 89 l 12 12 v 37 l -11 10 M 190 93 l 9 8 v 42 l -10 10', 'metal-hi fine');
    if (!mini)
      b +=
        P('M 63 75 H 162 L 182 85 H 306 M 64 154 H 173 L 195 162 H 306', 'edge') +
        repeat(4, (i) => R(174, 105 + i * 7, 2, 3, 'chip', 0.3));
    b += screw(58, 80) + screw(311, 87) + screw(307, 157) + screw(58, 150);
  }
  return {
    body: G('graphics-card', b),
    ports: [
      { x: 134, y: 196, dx: 0, dy: 20, label: 'PCIe' },
      { x: 294, y: 58, dx: 0, dy: -21, label: 'PWR' },
      { x: 35, y: 126, dx: -21, dy: 0, label: 'VIDEO' },
    ],
  };
}

function register(ctx) {
  const { T } = ctx;
  let b = '';
  b += P('M 49 174 H 310 M 49 174 V 152');
  b += repeat(8, (i) => {
    const x = 65 + i * 29;
    return (
      P(`M ${x + 12} 69 V 86 M ${x + 12} 145 V 174`) +
      R(x, 87, 24, 58, 'paper outline', 2) +
      R(x + 4, 96, 16, 28, i % 3 === 0 ? 'die' : 'soft', 2) +
      T(x + 12, 111, '01001101'[i], 16, 'mono') +
      P(`M ${x + 7} 145 l 5 -7 l 5 7`) +
      C(x + 12, 174, 2, 'dot')
    );
  });
  b += P('M 65 58 V 53 H 292 V 58') + T(179, 39, '8 БИТ', 12) + T(31, 151, 'CLK', 11);
  return {
    body: G('register-bank', b),
    ports: [
      { x: 49, y: 174, dx: -20, dy: 0, label: 'CLK' },
      { x: 180, y: 69, dx: 0, dy: -23, label: 'D[7:0]' },
    ],
  };
}

function rom(ctx) {
  const { T, mini } = ctx;
  let b = repeat(8, (i) => pin(98, 58 + i * 17, 24, 7) + pin(238, 58 + i * 17, 24, 7));
  if (!mini) b += repeat(8, (i) => P(`M 116 ${58 + i * 17} v 7 M 244 ${58 + i * 17} v 7`, 'micro'));
  b += P(
    'M 126 46 H 168 A 12 12 0 0 0 192 46 H 234 L 240 52 V 191 L 234 197 H 126 L 120 191 V 52 Z',
    'chip outline',
  );
  b += P('M 125 186 V 55 L 130 50 H 163 M 197 50 H 230 L 235 55 V 186', 'engraving');
  b += R(132, 73, 96, 86, 'gold fine', 2) + R(136, 77, 88, 78, 'metal-hi fine', 1);
  b += R(144, 85, 72, 62, 'die', 0.4);
  b +=
    repeat(6, (r) => P(`M 148 ${90 + r * 10} H 212`, 'micro')) +
    repeat(8, (c) => P(`M ${150 + c * 8.5} 88 V 145`, 'micro'));
  b += repeat(6, (r) =>
    repeat(8, (c) => ((r * 3 + c) % 5 < 2 ? C(150 + c * 8.5, 90 + r * 10, 1.5, 'die-dark') : '')),
  );
  if (!mini)
    b +=
      repeat(6, (i) =>
        P(`M 138 ${86 + i * 11} h 3 l 4 4 M 222 ${86 + i * 11} h -3 l -4 4`, 'micro'),
      ) +
      repeat(
        8,
        (i) => R(146 + i * 9, 79, 3, 3, 'gold', 0.3) + R(146 + i * 9, 150, 3, 3, 'gold', 0.3),
      );
  b += T(180, 174, 'ROM', 17, 'etch');
  if (!mini) b += C(129, 58, 2.3, 'metal-hi') + P('M 160 187 H 200 M 164 191 H 186', 'engraving');
  return {
    body: G('read-only-memory', b),
    ports: [
      { x: 98, y: 94, dx: -20, dy: 0, label: 'ADDR' },
      { x: 262, y: 128, dx: 20, dy: 0, label: 'DATA' },
    ],
  };
}

function cache(ctx) {
  const { T } = ctx;
  let b = '';
  for (let layer = 2; layer >= 0; layer--) {
    const x = 71 + layer * 14,
      y = 89 - layer * 20;
    b +=
      R(x, y, 190, 100, 'paper outline', 4) +
      R(x + 1, y + 1, 188, 24, 'metal-hi', 3) +
      T(x + 18, y + 14, `L${layer + 1}`, 12);
    if (layer === 0) {
      b += T(x + 59, y + 14, 'TAG', 11) + T(x + 132, y + 14, 'DATA', 11);
      for (let r = 0; r < 3; r++) {
        b +=
          C(x + 16, y + 39 + r * 23, 3, 'die-dark') +
          R(x + 31, y + 31 + r * 23, 44, 16, 'metal', 1);
        b += repeat(6, (c) =>
          R(x + 85 + c * 15, y + 31 + r * 23, 11, 16, r === 0 ? 'die' : 'soft', 1),
        );
      }
    }
  }
  return {
    body: G('cache-hierarchy', b),
    ports: [
      { x: 71, y: 140, dx: -23, dy: 0, label: 'ADDR' },
      { x: 261, y: 140, dx: 23, dy: 0, label: 'DATA' },
    ],
  };
}

function alu(ctx) {
  const { T } = ctx;
  let b = P('M 101 51 L 231 88 V 152 L 101 189 V 145 L 134 120 L 101 95 Z', 'paper outline');
  b += P('M 56 74 H 101 M 56 166 H 101 M 231 120 H 292 M 170 41 V 71');
  b +=
    T(180, 118, 'ALU', 23) +
    T(77, 58, 'A', 12) +
    T(77, 184, 'B', 12) +
    T(269, 105, 'Y', 12) +
    T(170, 27, 'OP', 12);
  return {
    body: G('alu', b),
    ports: [
      { x: 56, y: 74, dx: 0, dy: 0, label: 'A' },
      { x: 56, y: 166, dx: 0, dy: 0, label: 'B' },
      { x: 292, y: 120, dx: 0, dy: 0, label: 'Y' },
      { x: 170, y: 41, dx: 0, dy: 0, label: 'OP' },
    ],
  };
}

function dff(ctx) {
  const { T } = ctx;
  let b = R(128, 65, 104, 117, 'paper outline', 1) + P('M 128 142 l 12 9 l -12 9');
  b += P('M 79 96 H 128 M 79 151 H 128 M 232 96 H 281 M 244 151 H 281');
  b += C(238, 151, 6, 'paper outline');
  b += T(146, 96, 'D', 17) + T(214, 96, 'Q', 17) + T(215, 151, 'Q̅', 17) + T(101, 171, 'CLK', 11);
  return {
    body: G('d-flip-flop', b),
    ports: [
      { x: 79, y: 96, dx: 0, dy: 0, label: 'D' },
      { x: 79, y: 151, dx: 0, dy: 0, label: 'CLK' },
      { x: 281, y: 96, dx: 0, dy: 0, label: 'Q' },
      { x: 281, y: 151, dx: 0, dy: 0, label: 'Q̅' },
    ],
  };
}

const renderers = {
  cpu: cpuPackage,
  gpu: gpuPackage,
  'graphics-card': graphicsCard,
  alu,
  cell: memoryCell,
  register,
  ram,
  rom,
  cache,
  dff,
};
export { renderers };

export { register };
