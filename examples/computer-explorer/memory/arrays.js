import { R, P, G, memoryCell, C } from '../drawing/symbols.js';
function memoryArray(node, { scene, T, H }) {
  const sram = node.memory === 'sram';
  let b = R(74, 40, 487, 291, 'board outline', 4);
  for (let col = 0; col < 4; col++) {
    const x = 108 + col * 112;
    b += P(`M ${x} 32 V 328`, 'memory-wire');
    if (sram) b += P(`M ${x + 88} 32 V 328`, 'memory-wire');
    b += T(sram ? x + 44 : x, 18, sram ? `B${col} /B${col}` : `BL${col}`, 12);
  }
  for (let row = 0; row < 4; row++) {
    const y = 56 + row * 68;
    b += P(`M 43 ${y} H 551`, 'memory-wire') + T(48, y - 15, `WL${row}`, 12);
    if (!sram) b += P(`M 86 ${y + 58} H 550`, 'micro');
    for (let col = 0; col < 4; col++) {
      const x = 108 + col * 112,
        key = `cell-${row}-${col}`;
      if (sram) {
        const scale = 88 / 272;
        b += G(
          key,
          `<g class="memory-mini">${memoryCell({ T: () => '' }).body}</g>`,
          `translate(${x - 44 * scale} ${y - 41 * scale}) scale(${scale})`,
        );
        H(key, `Ячейка ${row}:${col}`, 'sram-cell', x + 8, y + 5, 75, 50);
      } else {
        let cell = P(
          `M ${x} ${y + 31} H ${x + 30} V ${y + 22} M ${x + 56} ${y + 22} V ${y + 31} H ${x + 75} V ${y + 45} M ${x + 30} ${y + 22} H ${x + 56} M ${x + 30} ${y + 16} H ${x + 56} M ${x + 43} ${y} V ${y + 16}`,
          'memory-wire',
        );
        cell += P(
          `M ${x + 64} ${y + 45} H ${x + 86} M ${x + 64} ${y + 51} H ${x + 86} M ${x + 75} ${y + 51} V ${y + 58}`,
          'memory-wire',
        );
        cell += C(x, y + 31, 2, 'dot') + C(x + 43, y, 2, 'dot') + C(x + 75, y + 58, 1.5, 'dot');
        b += G(key, cell);
        H(key, `Ячейка ${row}:${col}`, 'dram-cell', x + 17, y + 7, 78, 52);
      }
    }
  }
  scene.body = b;
  scene.caption = sram
    ? 'SRAM · пары B / B̅ · два инвертора и два транзистора доступа в каждой ячейке.'
    : 'DRAM · WL открывает транзистор между BL и конденсатором; нижняя обкладка соединена с Vplate.';
  return scene;
}
function norArray(node, { scene, T, H }) {
  let b = R(69, 36, 488, 291, 'board outline', 4);
  for (let col = 0; col < 4; col++) {
    const x = 143 + col * 116;
    b += P(`M ${x} 34 V 307 M ${x + 28} 88 V 326`, 'memory-wire') + T(x, 18, `BL${col}`, 13);
  }
  b += P('M 171 326 H 544', 'memory-wire') + T(545, 346, 'SL', 13);
  for (let row = 0; row < 4; row++) {
    const y = 51 + row * 64;
    b += P(`M 36 ${y} H 550`, 'memory-wire') + T(35, y - 14, `WL${row}`, 12);
    for (let col = 0; col < 4; col++) {
      const x = 143 + col * 116,
        bit = (row * 5 + col * 3 + (node.sector || 0)) % 5 < 2 ? 0 : 1;
      let cell = P(
        `M ${x} ${y + 16} H ${x - 15} V ${y + 23} M ${x - 15} ${y + 41} V ${y + 51} H ${x + 28} M ${x - 15} ${y + 23} V ${y + 41} M ${x - 29} ${y + 20} V ${y + 44} M ${x - 47} ${y} V ${y + 32} H ${x - 29}`,
        'memory-wire',
      );
      cell +=
        R(x - 24, y + 22, 4, 20, bit === 0 ? 'gold' : 'metal-hi', 0.5) +
        C(x, y + 16, 2, 'dot') +
        C(x + 28, y + 51, 2, 'dot') +
        C(x - 47, y, 2, 'dot');
      b += G(`cell-${row}-${col}`, cell) + T(x + 51, y + 34, bit, 17);
      H(`cell-${row}-${col}`, `Бит ${row}:${col} = ${bit}`, 'flash-cell', x - 40, y + 10, 104, 48, {
        bit,
      });
    }
  }
  scene.body = b;
  scene.caption =
    'NOR Flash · ячейки включены параллельно между битовой линией BL и общей линией истока SL.';
  return scene;
}
export { memoryArray, norArray };
