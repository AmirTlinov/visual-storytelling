import { rectBox } from '../drawing/geometry.js';
import { R, P, C, G, repeat, pin, passive, via } from '../drawing/symbols.js';
const ssdLayouts = {
  sata: {
    controller: rectBox(99, 120, 108, 108),
    dram: rectBox(103, 272, 100, 57),
    nand: [
      rectBox(266, 93, 115, 104),
      rectBox(411, 93, 115, 104),
      rectBox(266, 231, 115, 104),
      rectBox(411, 231, 115, 104),
    ],
    interface: rectBox(12, 89, 28, 265),
  },
  nvme: {
    controller: rectBox(91, 86, 75, 77),
    dram: rectBox(191, 93, 47, 65),
    nand: [rectBox(270, 79, 84, 99), rectBox(384, 79, 84, 99)],
    interface: rectBox(16, 48, 45, 152),
  },
};
function storageIC(key, p, label, T) {
  let b =
    R(p.x + 3, p.y + 3, p.w, p.h, 'shadow fine', 3) + R(p.x, p.y, p.w, p.h, 'chip outline', 3);
  b +=
    P(`M ${p.x + 6} ${p.y + p.h - 8} V ${p.y + 13} l 7 -7 H ${p.x + p.w - 8}`, 'engraving') +
    C(p.x + 12, p.y + 16, 2.5, 'metal-hi');
  b += T(p.x + p.w / 2, p.y + p.h * 0.48, label, 15, 'etch');
  b += P(
    `M ${p.x + p.w * 0.22} ${p.y + p.h * 0.72} h ${p.w * 0.55} M ${p.x + p.w * 0.22} ${p.y + p.h * 0.79} h ${p.w * 0.4}`,
    'engraving',
  );
  return G(key, b);
}
function sataConnector(T = () => '', x = 96, y = 14) {
  let b = R(x, y, 80, 28, 'chip outline', 2) + R(x + 92, y, 173, 28, 'chip outline', 2);
  b +=
    repeat(7, (i) => pin(x + 8 + i * 9, y + 4, 5, 15)) +
    repeat(15, (i) => pin(x + 101 + i * 10.2, y + 4, 5.5, 15));
  b += P(`M ${x + 7} ${y + 24} h 66 v -5 M ${x + 99} ${y + 24} h 158 v -5`, 'edge');
  return b + T(x + 40, y - 10, 'DATA · 7', 12) + T(x + 177, y - 10, 'POWER · 15', 12);
}
function sataSsdArt({ T, inside = false }) {
  let b = R(44, 40, 520, 350, 'shadow outline', 10) + R(40, 34, 520, 350, 'metal outline', 10);
  b +=
    G(
      'interface',
      sataConnector(() => '', 0, 0),
      'translate(40 89) rotate(90)',
    ) + R(51, 49, 498, 323, 'metal fine', 7);
  for (const [x, y] of [
    [56, 54],
    [544, 54],
    [56, 366],
    [544, 366],
  ])
    b += C(x, y, 5, 'chip fine') + P(`M ${x - 2} ${y} h 4`, 'edge');
  if (!inside) {
    b +=
      R(86, 96, 428, 234, 'metal-hi fine', 5) +
      T(300, 187, 'SSD', 48) +
      T(300, 245, '2.5″ · SATA', 22);
    b += repeat(5, (i) => P(`M 120 ${277 + i * 5} H ${260 - i * 12}`, 'engraving'));
    return { body: b };
  }
  b += R(72, 65, 461, 285, 'board outline', 4);
  const p = ssdLayouts.sata;
  p.nand.forEach((chip, i) => {
    b += repeat(5, (k) =>
      P(
        `M 207 ${140 + i * 16 + k * 3} H ${225 + k * 5} V ${chip.y + 29 + k * 9} H ${chip.x}`,
        'trace',
      ),
    );
  });
  b += P('M 40 129 H 83 V 160 H 99 M 151 228 V 272', 'trace');
  b += storageIC('controller', p.controller, 'CTRL', T) + storageIC('dram', p.dram, 'DRAM', T);
  p.nand.forEach((chip, i) => {
    b += storageIC(`nand-${i}`, chip, 'NAND', T);
  });
  b += repeat(7, (i) => passive(219, 91 + i * 33, 13, 6) + via(240, 102 + i * 33));
  return { body: b };
}
function nvmeSsdArt({ T }) {
  let b = P(
    'M 30 52 H 566 L 578 64 V 110 A 14 14 0 0 0 578 138 V 192 L 566 204 H 24 V 87 H 41 V 76 H 24 V 61 Z',
    'shadow outline',
  );
  b += P(
    'M 26 48 H 563 L 575 60 V 108 A 14 14 0 0 0 575 136 V 188 L 563 200 H 20 V 87 H 38 V 72 H 20 V 57 Z',
    'board outline',
  );
  b += G(
    'interface',
    repeat(38, (i) => {
      const y = 53 + i * 3.8;
      return y >= 72 && y < 87 ? '' : pin(20, y, 19, 2.4);
    }),
  );
  b +=
    P('M 46 57 H 552 M 47 190 H 554', 'trace') + P('M 557 111 A 23 23 0 0 0 557 134', 'gold fine');
  b += repeat(6, (i) => P(`M 39 ${99 + i * 10} H ${64 + i * 3} V ${103 + i * 7} H 91`, 'trace'));
  const p = ssdLayouts.nvme;
  p.nand.forEach((chip, i) => {
    b += repeat(5, (k) =>
      P(`M ${140 + k * 4} 163 V ${176 + i * 6 + k * 2} H ${chip.x + 15 + k * 9} V 178`, 'trace'),
    );
  });
  b += P('M 166 124 H 191', 'trace');
  b += storageIC('controller', p.controller, 'CTRL', T) + storageIC('dram', p.dram, 'RAM', T);
  p.nand.forEach((chip, i) => {
    b += storageIC(`nand-${i}`, chip, 'NAND', T);
  });
  b += G('power', R(491, 82, 36, 36, 'chip fine', 2) + R(497, 133, 27, 23, 'metal outline', 2));
  b +=
    repeat(7, (i) => passive(71 + i * 64, 64, 11, 5)) +
    repeat(5, (i) => passive(539, 64 + i * 25, 10, 5));
  b += repeat(14, (i) => via(61 + i * 34, 193)) + T(300, 224, 'M.2 2280 · PCIe ×4 · NVMe', 17);
  return { body: b };
}
export { nvmeSsdArt, sataConnector, sataSsdArt, ssdLayouts, storageIC };
