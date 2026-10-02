import { R, repeat, P, C, G } from '../drawing/symbols.js';

const nandSceneTypes = new Set([
  'nand-package',
  'nand-die',
  'nand-plane',
  'nand-block',
  'nand-page',
  'nand-string',
  'nand-cell',
  'nand-trap',
]);
function nandAddress(node) {
  return {
    drive: node.drive === 'nvme' ? 'nvme' : 'sata',
    chip: node.chip || 0,
    die: node.die || 0,
    plane: node.plane || 0,
    block: node.block || 0,
    row: node.row || 0,
    col: node.col || 0,
  };
}
function nandScene(node, model, { scene, T, H, array, bus }) {
  const address = nandAddress(node),
    bit = model.bit(address);
  const hit = (key, label, type, x, y, w, h, params = {}) =>
    H(key, label, type, x, y, w, h, { ...address, ...params });
  const miniature = (x, y, w, h) =>
    R(x, y, w, h, 'die-dark fine', 2) +
    repeat(8, (i) => R(x + 8, y + 9 + (i * (h - 19)) / 8, w - 16, 4, 'gold', 0.5)) +
    repeat(11, (i) => P(`M ${x + 12 + (i * (w - 24)) / 10} ${y + 5} V ${y + h - 5}`, 'edge'));
  let b = '';
  if (node.type === 'nand-package') {
    b = R(56, 42, 488, 273, 'chip outline', 9) + R(73, 58, 454, 238, 'board fine', 5);
    b += repeat(
      18,
      (i) => C(85 + i * 25, 307, 3.5, 'gold fine') + C(85 + i * 25, 51, 3.5, 'gold fine'),
    );
    for (let i = 0; i < 2; i++) {
      const x = 130 + i * 114,
        y = 98 + i * 69;
      b += G(`die-${i}`, R(x + 5, y + 6, 208, 116, 'shadow fine', 3) + miniature(x, y, 208, 116));
      b += repeat(10, (k) =>
        P(
          i
            ? `M ${x + 13 + k * 19} ${y + 110} Q ${x + 10 + k * 19} ${y + 144} ${234 + k * 25} 293`
            : `M ${x + 13 + k * 19} ${y + 5} Q ${x + 10 + k * 19} ${y - 24} ${89 + k * 20} 71`,
          'storage-bond',
        ),
      );
      b += T(x + 104, y + 62, `Кристалл ${i}`, 17, 'etch');
      // Exposed steps of the stack stay independently selectable.
      hit(`die-${i}`, `Кристалл NAND ${i}`, 'nand-die', x, y, 208, i === 0 ? 64 : 116, { die: i });
    }
    b += T(300, 339, 'BGA · многокристальный корпус', 16);
    scene.caption =
      'Под корпусом NAND находятся кристаллы, соединённые с подложкой. Здесь показаны два кристалла и проволочные соединения; число кристаллов и способ соединения зависят от изделия.';
  } else if (node.type === 'nand-die') {
    b = R(38, 27, 524, 302, 'chip outline', 4) + R(48, 37, 504, 282, 'die-dark fine', 2);
    for (let i = 0; i < 2; i++) {
      const x = 65 + i * 247;
      b += G(`plane-${i}`, miniature(x, 61, 222, 177)) + T(x + 111, 151, `Plane ${i}`, 21, 'etch');
      hit(`plane-${i}`, `Plane ${i}`, 'nand-plane', x, 61, 222, 177, { plane: i });
    }
    b +=
      G('page-buffer', array(66, 253, 468, 46, 2, 16)) +
      T(300, 310, 'БУФЕРЫ СТРАНИЦ И ПЕРИФЕРИЙНАЯ ЛОГИКА', 13, 'etch');
    hit('page-buffer', 'Буфер страницы · защёлки', 'register-file', 66, 253, 468, 46);
    scene.caption =
      'Кристалл разделён на planes с блоками NAND. Буферы страниц и периферийная логика считывают состояния и подают напряжения программирования. Число блоков сокращено для обзора.';
  } else if (node.type === 'nand-plane') {
    b = R(35, 31, 530, 286, 'die-dark outline', 5);
    for (let i = 0; i < 2; i++) {
      const x = 63 + i * 249;
      b += G(`block-${i}`, miniature(x, 66, 224, 204)) + T(x + 112, 168, `Блок ${i}`, 23, 'etch');
      hit(`block-${i}`, `Блок ${i}`, 'nand-block', x, 66, 224, 204, { block: i });
    }
    b += T(300, 340, 'Блок — единица стирания', 17);
    scene.caption =
      'В блоке множество вертикальных NAND-строк. Чтение и программирование организованы страницами, стирание — блоками. Открой блок и выбери WL, BL или конкретную ячейку.';
  } else if (node.type === 'nand-block' || node.type === 'nand-page') {
    const page = node.type === 'nand-page',
      rows = page ? 1 : 4;
    b = T(300, 23, page ? `Страница SLC · WL${address.row}` : 'SLC-модель · 4 WL × 8 BL', 18);
    for (let col = 0; col < 8; col++) {
      const x = 119 + col * 61;
      b +=
        G(`string-${col}`, R(x - 22, 43, 44, 30, 'soft fine', 3)) +
        T(x, 59, `${col}`, 14) +
        bus(x, 76, x, 305);
      hit(`string-${col}`, `Вертикальная строка BL${col}`, 'nand-string', x - 22, 43, 44, 30, {
        col,
      });
      if (!page)
        b += P(
          `M ${x - 8} 90 h 16 M ${x - 8} 98 h 16 M ${x - 8} 279 h 16 M ${x - 8} 287 h 16`,
          'line',
        );
    }
    for (let r = 0; r < rows; r++) {
      const row = page ? address.row : r,
        y = page ? 178 : 124 + r * 43;
      b +=
        bus(77, y, 572, y) +
        G(`page-${row}`, R(23, y - 16, 53, 32, 'soft fine', 2)) +
        T(49, y, `WL${row}`, 13);
      if (!page) hit(`page-${row}`, `Страница WL${row}`, 'nand-page', 23, y - 16, 53, 32, { row });
      for (let col = 0; col < 8; col++) {
        const x = 119 + col * 61,
          n = { ...address, row, col },
          value = model.bit(n),
          key = `cell-${row}-${col}`;
        b += G(
          key,
          R(x - 18, y - 15, 36, 30, value ? 'paper outline' : 'die outline', 3) +
            P(`M ${x - 26} ${y - 10} v 20`, 'line') +
            T(x, y, String(value), 17, 'mono'),
        );
        hit(key, `WL${row}, BL${col} · ${value}`, 'nand-cell', x - 20, y - 18, 40, 36, {
          row,
          col,
        });
      }
    }
    b +=
      bus(119, 305, 546, 305) +
      T(
        299,
        329,
        page ? '8 бит одной учебной страницы' : 'BL → SSL → ячейки последовательно → GSL → SL',
        14,
      );
    scene.caption = page
      ? 'Показаны 8 бит SLC-страницы. Буфер задаёт, какие ячейки программировать, а какие оставить в состоянии 1. Реальные страницы гораздо больше; TLC/QLC хранят несколько страниц в группе ячеек.'
      : 'WL выбирает уровень, BL — вертикальную строку. Транзисторы NAND соединены последовательно; SSL и GSL подключают строку к BL и общей source line. Нажми на отдельную ячейку.';
  } else if (node.type === 'nand-string') {
    b =
      R(264, 38, 71, 272, 'die outline', 4) +
      R(288, 38, 23, 272, 'soft fine', 2) +
      T(299, 20, `BL${address.col}`, 17);
    b += bus(299, 310, 299, 337) + T(366, 331, 'Source line', 15);
    for (const y of [58, 278])
      b +=
        R(230, y - 11, 137, 22, 'metal fine', 3) +
        R(283, y - 11, 33, 22, 'die fine', 1) +
        T(405, y, y === 58 ? 'SSL' : 'GSL', 16);
    for (let row = 0; row < 4; row++) {
      const y = 103 + row * 45,
        value = model.bit({ ...address, row });
      b += G(
        `cell-${row}`,
        R(198, y - 14, 202, 28, 'gold outline', 4) +
          R(244, y - 14, 111, 28, 'paper fine', 1) +
          R(258, y - 14, 83, 28, 'die-dark fine', 1) +
          R(272, y - 14, 55, 28, 'paper fine', 1) +
          R(283, y - 14, 33, 28, 'die fine', 1) +
          R(293, y - 14, 13, 28, 'soft', 0),
      );
      if (!value) b += C(264, y, 3, 'charge') + C(335, y, 3, 'charge');
      b += T(155, y, `WL${row}`, 16) + T(445, y, String(value), 17, 'mono');
      hit(`cell-${row}`, `Ячейка WL${row}, BL${address.col}`, 'nand-cell', 198, y - 14, 202, 28, {
        row,
      });
    }
    b += T(74, 185, '3D NAND', 16) + T(505, 290, 'Срез', 15);
    scene.caption =
      'Вертикальный канал проходит через уровни word line. На каждом уровне кольцевой затвор управляет участком канала через изоляторы и слой ловушек заряда. Показаны 4 уровня вместо сотен.';
  } else if (node.type === 'nand-cell') {
    const x = 190,
      y = 180;
    b =
      G('gate', C(x, y, 138, 'gold outline')) +
      C(x, y, 116, 'paper fine') +
      G('trap', C(x, y, 98, 'die-dark fine') + C(x, y, 80, 'paper fine')) +
      G('channel', C(x, y, 65, 'die fine') + C(x, y, 43, 'soft fine'));
    if (!bit)
      b += repeat(14, (i) => {
        const a = (i * Math.PI) / 7;
        return C(x + 89 * Math.cos(a), y + 89 * Math.sin(a), 3.5, 'charge');
      });
    b += T(x, y, bit ? '1' : '0', 32, 'mono');
    const labels = [
      [56, 'Word line · затвор', 124],
      [105, 'Блокирующий оксид', 108],
      [154, 'SiN · ловушки заряда', 89],
      [203, 'Туннельный оксид', 72],
      [252, 'Кремниевый канал', 54],
      [301, 'Сердечник · SiO₂', 30],
    ];
    labels.forEach(([yy, label, r]) => {
      b += P(`M ${x + r} ${y} L 344 ${yy} H 356`, 'leader') + T(365, yy, label, 14, '', 'start');
    });
    hit('trap', 'Ловушки заряда · SiN', 'nand-trap', 92, 82, 196, 196);
    b += T(190, 343, 'Поперечный срез', 15);
    scene.nand = { node: address };
    scene.caption = bit
      ? 'Стертая SLC-ячейка: низкий порог Vt, значение 1. «Записать 0» задаёт выбранный бит в буфере страницы и показывает накопление электронов в ловушках.'
      : 'Заряд в изолированном SiN повышает порог Vt: в этой SLC-модели это 0. Он сохраняется без питания. Вернуть 1 можно стиранием всего блока.';
  } else if (node.type === 'nand-trap') {
    const layers = [
      ['ЗАТВОР', 'gold', 44],
      ['Блокирующий оксид', 'paper', 51],
      ['SiN · ловушки', 'die-dark', 77],
      ['Туннельный оксид', 'paper', 33],
      ['Канал · поликремний', 'die', 65],
    ];
    let y = 36;
    layers.forEach(([label, cls, h], i) => {
      b += R(74, y, 286, h, `${cls} fine`, 1) + T(378, y + h / 2, label, 14, '', 'start');
      if (i === 2) {
        b += repeat(11, (k) => P(`M ${91 + k * 24} ${y + 28} l 7 11 l 7 -11`, 'edge'));
        if (!bit) b += repeat(11, (k) => C(98 + k * 24, y + 34, 3.5, 'charge'));
      }
      y += h;
    });
    b += T(300, 332, bit ? 'Стерто · низкий Vt' : 'Запрограммировано · высокий Vt', 18);
    scene.nand = { node: address };
    scene.caption =
      'Заряд локализуется в ловушках изолирующего слоя SiN. Для наглядности здесь SLC: 2 состояния, 1 бит. TLC различает 8 диапазонов Vt, QLC — 16; геометрия слоёв показана условно.';
  }
  scene.body = b;
  return scene;
}
export { nandSceneTypes, nandScene };
