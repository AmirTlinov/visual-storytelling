import { rectBox, sceneBoxes } from './drawing/geometry.js';
import {
  G,
  esc,
  R,
  P,
  repeat,
  gate,
  ram,
  cpuPackage,
  cpuDie,
  C,
  memoryCell,
} from './drawing/symbols.js';
import { imageJobScene } from './image-job/scenes.js';
import { cpuCycleScene } from './cpu/execution-scenes.js';
import { displaySceneTypes, displayScene } from './display/scenes.js';
import { unifiedSceneTypes, unifiedScene } from './board/unified-scenes.js';
import { ssdSceneTypes, ssdScene } from './storage/ssd-scenes.js';
import { nandSceneTypes, nandScene } from './storage/nand-scenes.js';
import { hddSceneTypes, hddScene } from './storage/hdd-scenes.js';
import { memoryArray } from './memory/arrays.js';
import { boardScene } from './board/scene.js';
import { gpuSceneTypes, gpuScene } from './gpu/scenes.js';
import { romSceneTypes, romScene } from './memory/rom-scenes.js';
import { ioSceneTypes, ioScene } from './io/scenes.js';
import { computeScene } from './cpu/structure-scenes.js';

const rootNode = { type: 'board', label: 'Плата' };
function makeScene(node, viewport, values, cycle, display, architecture = 'discrete', nand, job) {
  const unified = architecture === 'unified';
  const box =
    node.type === 'board'
      ? rectBox(0, 0, viewport.w < 520 ? 500 : 900, viewport.w < 520 ? 1050 : 795)
      : node.type.startsWith('image-')
        ? rectBox(0, 0, 600, 400)
        : unified && node.type === 'cpu-die'
          ? rectBox(119, 61, 124, 146)
          : sceneBoxes[node.type] || rectBox(0, 0, 600, 360);
  const fit = Math.min((viewport.w - 32) / box.w, (viewport.h - 60) / box.h);
  const T = (x, y, label, size = 14, cls = '', anchor = 'middle') =>
    `<text x="${x}" y="${y}" font-size="${Math.max(size, 11 / fit)}" class="${cls}" text-anchor="${anchor}" dominant-baseline="middle">${esc(label)}</text>`;
  const scene = { box, body: '', hits: [], caption: '', control: null };
  const control = (key, on, off) => ({ key, label: values[key] ? on : off });
  const imageRef =
    node.imageByte === undefined
      ? {}
      : { imageByte: node.imageByte, imageBit: node.imageBit, imageLocation: node.imageLocation };
  const H = (key, label, type, x, y, w, h, params = {}) =>
    scene.hits.push({
      key,
      label,
      node: { type, label, ...imageRef, ...params },
      box: rectBox(x, y, w, h),
    });
  const tile = (x, y, w, h, label, kind = 'paper') =>
    R(x, y, w, h, `${kind} outline`, 4) + T(x + w / 2, y + h / 2, label, 15);
  const bus = (x1, y1, x2, y2) => P(`M ${x1} ${y1} L ${x2} ${y2}`);
  const arrow = (x, y, dir = 'right') =>
    G(
      'signal-direction',
      P('M -6 -4 L 0 0 L -6 4 Z', 'arrow'),
      `translate(${x} ${y}) rotate(${dir === 'down' ? 90 : dir === 'up' ? -90 : dir === 'left' ? 180 : 0})`,
    );
  const array = (x, y, w, h, rows = 4, cols = 8) =>
    R(x, y, w, h, 'chip fine', 2) +
    R(x + 3, y + 5, 4, h - 10, 'metal-hi', 0.5) +
    repeat(rows, (r) => {
      const yy = y + 5 + (r * (h - 12)) / rows;
      return (
        P(`M ${x + 7} ${yy + 2} H ${x + w - 4}`, 'micro') +
        repeat(cols, (c) =>
          R(
            x + 10 + (c * (w - 14)) / cols,
            yy,
            (w - 14) / cols - 2.5,
            (h - 12) / rows - 3,
            'die',
            0.3,
          ),
        )
      );
    }) +
    repeat(cols, (c) =>
      R(x + 11 + (c * (w - 14)) / cols, y + h - 5, (w - 14) / cols - 4, 2, 'metal-hi', 0.2),
    );
  const wedge = (x, y, w, h, label = 'ALU') =>
    P(
      `M ${x} ${y} L ${x + w} ${y + h * 0.25} V ${y + h * 0.75} L ${x} ${y + h} V ${y + h * 0.66} L ${x + w * 0.24} ${y + h * 0.5} L ${x} ${y + h * 0.34} Z`,
      'paper outline',
    ) + T(x + w * 0.57, y + h * 0.5, label, 17);
  const mark = (kind, x, y, s = 1) =>
    G(
      kind,
      gate({ T: () => '' }, kind).body,
      `translate(${x - 77 * s} ${y - 120 * s}) scale(${s})`,
    );
  const ctx = { T, mini: false, inside: false, display, unified };
  const art = { scene, T, H, tile, bus, arrow, array, wedge, mark, ctx, control, display, unified };
  if (node.type.startsWith('image-')) return imageJobScene(node, job, art);
  if (node.cpuCycle) return cpuCycleScene(node, viewport, cycle, art);
  if (displaySceneTypes.has(node.type)) return displayScene(node, display, art);
  if (unifiedSceneTypes.has(node.type)) return unifiedScene(node, art);
  if (ssdSceneTypes.has(node.type)) return ssdScene(node, art);
  if (nandSceneTypes.has(node.type)) return nandScene(node, nand, art);
  if (hddSceneTypes.has(node.type)) return hddScene(node, values, art);
  let b = '';
  if (node.type === 'ram') {
    b = ram(ctx).body;
    for (let i = 0; i < 8; i++) H(`chip-${i}`, `DRAM ${i + 1}`, 'dram', 53 + i * 32, 98, 25, 50);
    scene.caption =
      'Нажми на любую микросхему памяти. Колесо или жест двумя пальцами меняет масштаб.';
  } else if (node.type === 'cpu') {
    b = cpuPackage(ctx).body;
    H('die', 'Кристалл', 'cpu-die', 122, 64, 118, 116);
    scene.caption = 'Открой корпус процессора, затем выбери отдельное ядро или кэш.';
  } else if (node.type === 'cpu-die') {
    b = cpuDie(ctx).body;
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 3; col++)
        H(
          `core-${row * 3 + col}`,
          `Ядро C${row * 3 + col}`,
          'core',
          132 + col * 34,
          74 + row * 37,
          27,
          29,
          { cpuCycle: row === 0 && col === 0 },
        );
    H('cache', 'Кэш', 'cache-level', 132, 150, 95, 18);
    if (unified) H('memory', 'Общая память CPU / GPU', 'unified-memory', 132, 184, 95, 14);
    scene.caption = unified
      ? 'CPU внутри SoC: C0 раскрывается до тактов, а выход в общую память ведёт к тем же байтам, которые доступны GPU.'
      : 'C0 раскрывается до выполнения по тактам. Общий кэш хранит данные.';
  } else if (node.type === 'dram') {
    b = R(46, 25, 508, 303, 'chip outline', 8) + R(60, 39, 480, 274, 'board fine', 4);
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 4; col++) {
        const x = 80 + col * 111,
          y = 58 + row * 122;
        b +=
          G(`bank-${row * 4 + col}`, array(x, y, 97, 86)) +
          T(x + 48.5, y + 101, `Банк ${row * 4 + col}`, 14);
        H(`bank-${row * 4 + col}`, `Банк ${row * 4 + col}`, 'bank', x, y, 97, 86, {
          memory: node.memory || 'dram',
        });
      }
    const technology = node.memory === 'gddr' ? 'GDDR' : node.memory === 'lpddr' ? 'LPDDR' : 'DRAM';
    scene.caption = `Чип ${technology} содержит банки DRAM. Содержимое ячеек требует питания и периодического обновления.`;
  } else if (node.type === 'bank') {
    b =
      R(44, 26, 512, 293, 'board outline', 5) +
      P('M 59 70 L 96 48 V 268 L 59 245 Z', 'metal outline') +
      T(77, 291, 'ADDR', 12);
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 2; col++) {
        const x = 120 + col * 209,
          y = 51 + row * 115;
        b += G(`array-${row * 2 + col}`, array(x, y, 183, 91, 4, 9));
        H(`array-${row * 2 + col}`, `Матрица ${row * 2 + col + 1}`, 'array', x, y, 183, 91, {
          memory: node.memory || 'dram',
        });
        b += bus(97, y + 45, x, y + 45);
      }
    b +=
      G('row-buffer', R(120, 289, 392, 17, 'metal-hi fine', 1)) + T(316, 297, 'БУФЕР СТРОКИ', 12);
    H('row-buffer', 'Буфер строки', 'row-buffer', 120, 284, 392, 29);
    scene.caption = 'Банк содержит матрицы ячеек и буфер строки. Открой любую матрицу.';
  } else if (node.type === 'array') {
    return memoryArray(node, art);
  } else if (node.type === 'dram-cell') {
    b = bus(70, 57, 70, 290) + T(70, 35, 'BL', 16) + bus(122, 65, 334, 65) + T(229, 43, 'WL', 16);
    b +=
      P('M 70 174 H 192 V 152 M 252 152 V 174 H 413 V 213 M 222 65 V 141') +
      G('access', P('M 192 152 H 252 M 192 141 H 252'));
    b +=
      G('capacitor', P('M 374 213 H 452 M 374 231 H 452')) +
      P('M 413 231 V 277') +
      T(413, 294, 'Vplate', 13);
    b += C(70, 174, 3, 'dot') + T(221, 214, 'Транзистор', 15) + T(413, 330, 'Конденсатор', 15);
    H('access', 'Транзистор', 'transistor', 167, 116, 111, 68, { polarity: 'n' });
    H('capacitor', 'Конденсатор', 'capacitor', 364, 203, 98, 44);
    scene.caption =
      'WL открывает транзистор между BL и конденсатором. Заряд хранит бит и постепенно утекает — нужен refresh.';
  } else if (node.type === 'sram-cell') {
    b = memoryCell(ctx).body;
    H('inverter-a', 'Инвертор', 'gate', 140, 70, 52, 41, { op: 'NOT' });
    H('inverter-b', 'Инвертор', 'gate', 166, 132, 54, 42, { op: 'NOT' });
    H('access-a', 'Транзистор доступа', 'transistor', 52, 102, 36, 28, { polarity: 'n' });
    H('access-b', 'Транзистор доступа', 'transistor', 273, 102, 36, 28, { polarity: 'n' });
    scene.caption =
      'Два инвертора с обратной связью удерживают бит. Нажми на инвертор или транзистор.';
  } else if (node.type === 'register-file') {
    b = R(55, 33, 490, 291, 'chip outline', 6);
    for (let row = 0; row < 4; row++) {
      const y = 55 + row * 63;
      b += T(87, y + 22, `R${row}`, 14, 'etch');
      b += G(
        `word-${row}`,
        repeat(8, (col) => R(126 + col * 47, y, 39, 45, col % 3 ? 'die' : 'metal-hi', 2)),
      );
      H(`word-${row}`, `Слово R${row}`, 'register-word', 120, y, 383, 45);
    }
    scene.caption = 'Учебный регистровый файл: выбери слово, затем отдельный разряд.';
  } else if (node.type === 'register-word') {
    b = bus(45, 264, 557, 264);
    for (let bit = 0; bit < 8; bit++) {
      const x = 49 + bit * 64;
      b +=
        G(
          `bit-${7 - bit}`,
          R(x, 98, 53, 118, 'paper outline', 3) +
            R(x + 7, 110, 39, 63, bit % 3 ? 'die' : 'soft', 2) +
            P(`M ${x + 19} 194 h 15 M ${x + 19} 202 h 15 M ${x + 26.5} 202 V 216`),
        ) +
        T(x + 26.5, 141, '01001101'[bit], 22, 'mono') +
        bus(x + 26.5, 75, x + 26.5, 98) +
        bus(x + 26.5, 216, x + 26.5, 264) +
        T(x + 26.5, 58, `b${7 - bit}`, 13);
      H(`bit-${7 - bit}`, `Бит ${7 - bit}`, 'sram-cell', x, 98, 53, 118);
    }
    b += T(300, 303, 'ЗАПИСЬ СЛОВА', 14);
    scene.caption =
      'Слово регистрового файла: общая линия разрешает запись. Каждый бит раскрывается до SRAM.';
  } else if (node.type === 'cache-level') {
    b =
      R(51, 40, 497, 278, 'paper outline', 5) +
      T(107, 70, 'V', 13) +
      T(216, 70, 'TAG', 13) +
      T(408, 70, 'DATA', 13);
    for (let row = 0; row < 4; row++) {
      const y = 95 + row * 51;
      b +=
        C(105, y + 18, 5, 'die-dark') +
        G(`tag-${row}`, R(154, y, 119, 36, 'metal fine', 2)) +
        G(`data-${row}`, array(300, y, 212, 36, 1, 8));
      H(`data-${row}`, `Данные ${row}`, 'array', 300, y, 212, 36, { memory: 'sram' });
      H(`tag-${row}`, `Тег ${row}`, 'register-word', 154, y, 119, 36);
    }
    scene.caption = 'В строке кэша есть тег адреса и данные. Данные раскрываются до SRAM.';
  } else if (node.type === 'capacitor') {
    b =
      R(132, 99, 336, 22, 'metal outline', 2) +
      R(132, 218, 336, 22, 'metal outline', 2) +
      R(132, 126, 336, 87, 'soft', 1) +
      bus(300, 53, 300, 99) +
      bus(300, 240, 300, 298);
    b += T(300, 77, 'ЭЛЕКТРОД', 13) + T(300, 170, 'ДИЭЛЕКТРИК', 15) + T(300, 265, 'ЭЛЕКТРОД', 13);
    if (values.charge)
      b += repeat(8, (i) => C(151 + i * 42, 111, 4, 'charge') + T(151 + i * 42, 229, '+', 14));
    scene.control = control('charge', 'Конденсатор: заряжен', 'Конденсатор: разряжен');
    scene.caption = values.charge
      ? 'Разделённый заряд на электродах создаёт электрическое поле.'
      : 'Разрядка убирает разность зарядов между электродами.';
  }
  scene.body = b;
  if (!b) {
    if (node.type === 'board') return boardScene(viewport, art);
    if (gpuSceneTypes.has(node.type)) return gpuScene(node, art);
    if (romSceneTypes.has(node.type)) return romScene(node, values, art);
    if (ioSceneTypes.has(node.type)) return ioScene(node, values, art);
    return computeScene(node, viewport, values, art);
  }
  return scene;
}
export { rootNode, makeScene };
