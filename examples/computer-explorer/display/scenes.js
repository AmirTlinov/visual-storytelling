import { repeat, R, G, P, pin, C } from '../drawing/symbols.js';
import { rectBox } from '../drawing/geometry.js';
import { monitorArt } from '../io/art.js';

const displaySceneTypes = new Set([
  'monitor',
  'display-pixels',
  'display-scanout',
  'display-framebuffer',
  'lcd-pixel',
  'lcd-tft',
  'lcd-channel',
  'lcd-storage',
  'lcd-optics',
]);
const colorRect = (x, y, w, h, color) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}"/>`;
const displayPixelBox = (display, box, row, col) =>
  rectBox(
    box.x + (col * box.w) / display.width,
    box.y + (row * box.h) / display.height,
    box.w / display.width,
    box.h / display.height,
  );
function displayHits(display, box, H) {
  for (let row = 0; row < display.height; row++)
    for (let col = 0; col < display.width; col++) {
      const { x, y, w, h } = displayPixelBox(display, box, row, col);
      H(`pixel-${row}-${col}`, `Пиксель (${col}, ${row})`, 'lcd-pixel', x, y, w, h, { row, col });
    }
}
function displayRaster(display, box, source = 'panel', stripes = false) {
  const cells = repeat(display.height, (row) =>
    repeat(display.width, (col) => {
      const { x, y, w, h } = displayPixelBox(display, box, row, col),
        gap = Math.min(w, h) * 0.06;
      const body = stripes
        ? R(x, y, w, h, 'chip', 0) +
          repeat(3, (c) =>
            colorRect(
              x + gap + (c * (w - gap * 2)) / 3,
              y + gap,
              (w - gap * 2) / 3 - gap * 0.4,
              h - gap * 2,
              display.color(row, col, source, c),
            ),
          )
        : colorRect(x, y, w + 0.1, h + 0.1, display.color(row, col, source));
      return G(`pixel-${row}-${col}`, body);
    }),
  );
  const grid =
    repeat(
      display.width - 1,
      (c) => `M ${box.x + ((c + 1) * box.w) / display.width} ${box.y} v ${box.h} `,
    ) +
    repeat(
      display.height - 1,
      (r) => `M ${box.x} ${box.y + ((r + 1) * box.h) / display.height} h ${box.w} `,
    );
  return cells + (stripes ? '' : P(grid, 'display-grid'));
}
function displayScene(node, display, { scene, T, H, ctx, bus, arrow, unified }) {
  const row = node.row ?? 0,
    col = node.col ?? 0,
    channel = node.channel ?? 0;
  const rgb = display.rgb(row, col),
    source = display.rgb(row, col, 'vram'),
    names = ['R', 'G', 'B'];
  const selected = { row, col, channel },
    open = display.gateOpen(row),
    held = rgb[channel];
  const go = (key, label, type, x, y, w, h, params = {}) =>
    H(key, label, type, x, y, w, h, { ...selected, ...params });
  const memory = unified ? 'LPDDR' : 'VRAM';
  scene.display = {
    pixel: node.row === undefined ? null : { row, col },
    memoryLabel: unified ? 'Общая LPDDR' : 'VRAM',
  };
  let b = '';
  if (node.type === 'monitor') {
    b = monitorArt(ctx).body;
    H('pixels', 'Матрица LCD', 'display-pixels', 25, 27, 310, 153);
    displayHits(display, rectBox(33, 35, 294, 135), H);
    scene.caption = `${display.width} × ${display.height} пикселей. Нажми на любой пиксель; колесо или жест двумя пальцами приближает экран. Рамка открывает матрицу LCD.`;
  } else if (node.type === 'display-pixels') {
    b = R(43, 22, 532, 375, 'metal outline', 5) + R(95, 72, 471, 315, 'paper fine', 2);
    b +=
      G(
        'timing',
        R(127, 30, 430, 29, 'chip outline', 2) + repeat(18, (i) => pin(136 + i * 23, 59, 4, 15)),
      ) + T(342, 44, 'TCON → ДРАЙВЕР СТОЛБЦОВ', 14, 'etch');
    H('timing', `Развёртка: ${memory} → TCON → LCD`, 'display-scanout', 127, 28, 430, 34);
    b += G(
      'gate-driver',
      R(51, 91, 30, 285, 'chip outline', 2) + repeat(12, (i) => pin(81, 99 + i * 23, 13, 4)),
    );
    H('gate-driver', 'Драйвер строк', 'display-scanout', 48, 86, 40, 294);
    const box = rectBox(126, 90, 432, 288);
    b += displayRaster(display, box, 'panel', true);
    displayHits(display, box, H);
    for (let c = 0; c < display.width; c += 4)
      b += T(box.x + ((c + 0.5) * box.w) / display.width, 78, `x${c}`, 12);
    for (let r = 0; r < display.height; r++) {
      const y = box.y + (r * box.h) / display.height,
        mid = y + box.h / display.height / 2;
      if (r % 3 === 0) b += T(109, mid, `${r}`, 13);
      b += P(`M 81 ${mid} H 94`, display.gateOpen(r) ? 'active-path' : 'trace');
      if (display.gateOpen(r)) b += P(`M 126 ${y + 1} H 558`, 'active-path');
    }
    b +=
      T(63, 409, 'GATE', 12) +
      T(342, 409, `${display.width} × ${display.height} · RGB-полосы одного кадра`, 14);
    scene.caption =
      'Строка открывает TFT; три линии данных задают R, G и B каждого пикселя. После закрытия TFT ячейки удерживают яркость.';
  } else if (node.type === 'display-scanout') {
    b = G(
      'framebuffer',
      R(39, 45, 161, 162, 'board outline', 5) +
        R(48, 54, 143, 144, 'chip fine', 2) +
        displayRaster(display, rectBox(57, 71, 126, 84), 'vram'),
    );
    b += T(120, 178, memory, 16, 'etch');
    H('framebuffer', `Кадр в ${memory}`, 'display-framebuffer', 39, 45, 161, 162);
    b +=
      G(
        'timing',
        R(251, 97, 90, 90, 'chip outline', 3) +
          repeat(6, (i) => pin(242, 105 + i * 13, 9, 5) + pin(341, 105 + i * 13, 9, 5)),
      ) +
      T(296, 130, 'TCON', 15, 'etch') +
      T(296, 155, `${display.stride} B`, 14, 'etch');
    b +=
      G(
        'panel',
        R(390, 45, 168, 162, 'metal outline', 5) +
          displayRaster(display, rectBox(402, 62, 144, 96)),
      ) + T(474, 179, 'LCD', 16);
    H('panel', 'Матрица LCD', 'display-pixels', 390, 45, 168, 162);
    b += bus(200, 124, 242, 124) + arrow(237, 124) + bus(350, 142, 390, 142) + arrow(384, 142);
    b +=
      T(221, 79, unified ? 'DISP' : 'GPU', 14) +
      T(369, 100, 'DATA', 12) +
      T(300, 232, `Строка ${display.latchRow} · буфер TCON`, 17);
    for (let c = 0; c < display.width; c++) {
      const x = 48 + (c * 504) / display.width,
        w = 504 / display.width;
      b += G(
        `latched-${c}`,
        R(x, 277, w, 65, 'chip fine', 0) +
          colorRect(
            x + 1,
            279,
            w - 2,
            61,
            `rgb(${display.latch.slice(c * 3, c * 3 + 3).join(' ')})`,
          ),
      );
      if (c % 4 === 0) b += T(x + w / 2, 262, `x${c}`, 13);
    }
    b += T(300, 365, `${display.stride} байта · ${display.width} × RGB888`, 14);
    b += T(
      300,
      400,
      display.phase === 'write' ? `GATE[${display.row}] = 1 · запись` : 'GATE = 0 · удержание',
      15,
    );
    scene.caption =
      (unified
        ? 'Контроллер дисплея SoC считывает RGB888 из общей LPDDR'
        : 'GPU считывает RGB888 из VRAM') +
      '; видеолиния доставляет их в TCON. В модели строка передаётся одним шагом, затем драйвер записывает её в LCD.';
  } else if (node.type === 'display-framebuffer') {
    b =
      R(37, 29, 526, 331, 'board outline', 6) +
      T(300, 50, `${scene.display.memoryLabel} · RGB888 · ${display.vram.length} байта`, 17);
    const box = rectBox(107, 94, 432, 240);
    b += displayRaster(display, box, 'vram');
    displayHits(display, box, H);
    for (let c = 0; c < display.width; c += 4)
      b += T(box.x + ((c + 0.5) * box.w) / display.width, 77, `x${c}`, 12);
    for (let r = 0; r < display.height; r += 3)
      b += T(73, box.y + ((r + 0.5) * box.h) / display.height, `y${r}`, 13);
    b += T(300, 390, `Адрес RGB = (y × ${display.width} + x) × 3`, 15);
    scene.caption = `У каждого пикселя три последовательных байта R, G, B. Изменение ${memory} попадёт на экран после передачи и записи соответствующей строки.`;
  } else if (node.type === 'lcd-pixel') {
    b = T(
      300,
      20,
      `Пиксель (${col}, ${row}) · адрес 0x${display.address(row, col).toString(16).padStart(2, '0')}`,
      17,
    );
    names.forEach((name, c) => {
      const x = 34 + c * 184;
      b +=
        T(x + 92, 48, `${name} ${rgb[c]}`, 17) +
        G(
          `lc-${name.toLowerCase()}`,
          R(x + 24, 66, 132, 120, 'chip outline', 3) +
            colorRect(x + 30, 72, 120, 108, display.color(row, col, 'panel', c)),
        );
      go(
        `lc-${name.toLowerCase()}`,
        `${name}: свет через LCD`,
        'lcd-optics',
        x + 24,
        66,
        132,
        120,
        { channel: c },
      );
      b += P(
        `M ${x + 12} 106 V 205 H ${x + 54} V 220 M ${x + 92} 220 V 205 H ${x + 135} V 186 M ${x + 135} 205 H ${x + 158} V 266`,
        'line',
      );
      b += T(x + 2, 88, 'D', 12) + C(x + 135, 205, 3, 'dot');
      b +=
        G(
          `tft-${name.toLowerCase()}`,
          P(
            `M ${x + 54} 220 H ${x + 92} M ${x + 54} 231 H ${x + 92}`,
            open ? 'active-path' : 'line',
          ),
        ) + P(`M ${x + 73} 231 V 322`, 'line');
      b += T(x + 73, 270, 'TFT', 14);
      go(`tft-${name.toLowerCase()}`, `TFT · ${name}`, 'lcd-tft', x + 43, 209, 60, 35, {
        channel: c,
      });
      b +=
        G(
          `storage-${c}`,
          P(`M ${x + 145} 266 H ${x + 171} M ${x + 145} 279 H ${x + 171}`, 'line'),
        ) +
        P(`M ${x + 158} 279 V 356`, 'line') +
        T(x + 158, 245, 'Cs', 13);
      go(`storage-${c}`, `Заряд ячейки ${name}`, 'lcd-storage', x + 139, 256, 38, 34, {
        channel: c,
      });
    });
    b += P('M 36 322 H 485', open ? 'active-path' : 'line') + P('M 54 356 H 573', 'line');
    b += T(130, 339, `GATE[${row}] = ${open ? 1 : 0}`, 13) + T(87, 374, 'VCOM', 13);
    scene.caption = `В ячейках: RGB ${rgb.join(', ')}. В ${memory}: ${source.join(', ')}.${row === display.latchRow ? ` В буфере TCON: ${display.latch.slice(col * 3, col * 3 + 3).join(', ')}.` : ''} TFT ${open ? 'открыт для записи' : 'закрыт; заряд удерживается Cs и ёмкостью LC'}.`;
  } else if (node.type === 'lcd-tft') {
    b = R(61, 280, 478, 69, 'paper outline', 3) + T(300, 325, 'СТЕКЛЯННАЯ ПОДЛОЖКА', 14);
    b +=
      R(193, 254, 214, 18, 'metal outline', 1) +
      R(61, 234, 478, 20, 'gold fine', 1) +
      T(477, 243, 'SiNₓ', 13);
    b +=
      R(99, 216, 402, 18, 'die fine', 1) +
      G(
        'channel',
        R(207, 216, 186, 18, 'die', 0) +
          (open
            ? P('M 208 229 H 392', 'active-path') +
              repeat(9, (i) => C(218 + i * 20, 229, 2.5, 'charge'))
            : ''),
      );
    b +=
      R(104, 208, 103, 8, 'die-dark fine', 1) +
      R(393, 208, 103, 8, 'die-dark fine', 1) +
      R(99, 189, 113, 19, 'metal outline', 1) +
      R(388, 189, 113, 19, 'metal outline', 1);
    b += P('M 154 189 V 147 H 84 M 445 189 V 147 H 519 M 193 263 H 79', 'line');
    b +=
      T(122, 125, 'DATA', 15) +
      T(483, 125, 'К ЯЧЕЙКЕ', 14) +
      T(110, 286, 'GATE', 14) +
      T(300, 191, 'a-Si:H', 16);
    b +=
      T(300, 49, `TFT ${names[channel]} · (${col}, ${row})`, 18) +
      T(300, 83, open ? 'Строка выбрана · канал открыт' : 'Строка не выбрана · канал закрыт', 15);
    go('channel', 'Канал тонкоплёночного транзистора', 'lcd-channel', 203, 214, 193, 25);
    scene.caption =
      'Разрез TFT с нижним затвором: металл, изолятор SiNₓ и тонкий слой a-Si:H на стекле. Затвор управляется выбором строки.';
  } else if (node.type === 'lcd-channel') {
    b = T(300, 35, `Канал TFT ${names[channel]} · (${col}, ${row})`, 19);
    b +=
      R(70, 115, 460, 89, 'die outline', 2) +
      R(70, 215, 460, 60, 'gold fine', 2) +
      R(70, 286, 460, 33, 'metal outline', 2);
    b += R(70, 92, 112, 23, 'metal outline', 2) + R(418, 92, 112, 23, 'metal outline', 2);
    b +=
      T(125, 73, 'SOURCE', 13) +
      T(474, 73, 'DRAIN', 13) +
      T(300, 144, 'a-Si:H', 15) +
      T(300, 245, 'SiNₓ · изолятор', 16) +
      T(300, 303, `GATE[${row}] = ${open ? 1 : 0}`, 15);
    if (open) {
      b += repeat(12, (i) => C(95 + i * 37, 188, 6, 'paper fine') + T(95 + i * 37, 188, '−', 12));
      b += [118, 170, 430, 482]
        .map((x) => P(`M ${x} 280 V 216 m -4 6 l 4 -6 l 4 6`, 'active-path'))
        .join('');
    }
    b += T(
      300,
      357,
      open ? 'Электроны образуют канал у изолятора' : 'Проводящий канал не сформирован',
      15,
    );
    scene.caption =
      'Положительное поле нижнего затвора притягивает электроны к границе a-Si:H / SiNₓ. При закрытии TFT накопленный заряд остаётся в ячейке LCD.';
  } else if (node.type === 'lcd-storage') {
    b = T(300, 33, `${names[channel]} (${col}, ${row}) · удерживаемый код ${held}`, 18);
    b += P(
      'M 64 136 H 162 V 124 M 200 124 V 136 H 516 M 259 136 V 217 M 447 136 V 217 M 259 244 V 307 M 447 244 V 307 M 197 307 H 508 M 181 113 V 85',
      'line',
    );
    b += P('M 162 124 H 200 M 162 113 H 200', open ? 'active-path' : 'line');
    b +=
      T(100, 112, 'DATA', 14) +
      T(182, 168, `TFT ${open ? 'ON' : 'OFF'}`, 14) +
      T(181, 65, `GATE ${open ? 1 : 0}`, 13);
    b += P('M 226 217 H 292 M 226 244 H 292 M 414 217 H 480 M 414 244 H 480', 'line');
    b +=
      C(259, 136, 3, 'dot') +
      C(447, 136, 3, 'dot') +
      T(259, 267, 'Cs', 16) +
      T(447, 267, 'Cₗ꜀', 16) +
      T(362, 329, 'VCOM', 15);
    b += T(365, 100, `Полярность ${display.polarities[row] > 0 ? '+' : '−'} относительно VCOM`, 14);
    b += T(
      300,
      375,
      open ? 'Запись напряжения в обе ёмкости' : 'TFT закрыт · обе ёмкости сохраняют напряжение',
      15,
    );
    scene.caption =
      'Cs и ёмкость жидкого кристалла подключены параллельно. Полярность напряжения меняется между кадрами; код яркости от этого не меняется.';
  } else if (node.type === 'lcd-optics') {
    b = T(300, 28, `${names[channel]} (${col}, ${row}) · код ${held}`, 18);
    const layers = [
      ['LED-подсветка', 'metal-hi'],
      ['Рассеиватель', 'paper'],
      ['Поляризатор', 'soft'],
      ['Стекло · ITO 1', 'metal'],
      ['Жидкий кристалл', 'die'],
      ['Стекло · ITO 2', 'metal'],
      ['Фильтр ' + names[channel], 'paper'],
      ['Анализатор', 'soft'],
    ];
    layers.forEach(([label, kind], i) => {
      const y = 55 + i * 36;
      b += R(85, y, 200, 24, `${kind} fine`, 2) + T(327, y + 12, label, 14, '', 'start');
      if (i === 0)
        b += repeat(8, (n) =>
          R(95 + n * 23, y + 7, 12, 10, display.backlight ? 'gold' : 'chip', 1),
        );
      if (i === 2 || i === 7)
        b += repeat(12, (n) => P(`M ${95 + n * 15} ${y + 4} l ${i === 2 ? 6 : -6} 16`, 'micro'));
      if (i === 4) b += repeat(9, (n) => P(`M ${100 + n * 20} ${y + 7} l 8 10`, 'fine'));
      if (i === 6)
        b += colorRect(
          87,
          y + 2,
          196,
          20,
          `rgb(${names.map((_, c) => (c === channel ? 255 : 0)).join(' ')})`,
        );
    });
    b +=
      P('M 185 50 V 337', 'leader') +
      arrow(185, 337, 'down') +
      colorRect(114, 350, 142, 35, display.color(row, col, 'panel', channel));
    b += T(
      327,
      367,
      display.backlight ? `${names[channel]} = ${held}` : 'Свет не поступает',
      16,
      '',
      'start',
    );
    scene.caption =
      'Подсветка даёт свет; электрическое поле в LC меняет поляризацию, анализатор — пропускание, цветовой фильтр выделяет канал. RGB-код показан в шкале sRGB.';
  }
  scene.body = b;
  return scene;
}
export { displaySceneTypes, displayScene, displayRaster, colorRect };
