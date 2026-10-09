import { rectBox, placedArt, sceneBoxes } from '../drawing/geometry.js';
import { P, R, C, repeat, passive, via, G, cpuPackage, ram, pin } from '../drawing/symbols.js';
import { unifiedAssembly, unifiedTargets, unifiedLayout } from './unified-scenes.js';
import { graphicsAssembly, graphicsLayout } from '../gpu/scenes.js';
import { flashPackage, keyboardArt, mouseArt, monitorArt, speakerArt } from '../io/art.js';
import { boardStorage } from './storage.js';

function boardScene({ scene, T, H, display, unified }) {
  const board = rectBox(190, 27, 514, 555);
  const layout = {
    cpu: rectBox(280, 72, 144, 145),
    ram: rectBox(470, 74, 206, 90),
    graphics: rectBox(463, 240, 232, 174),
    rom: rectBox(277, 293, 103, 102),
    io: rectBox(398, 270, 65, 65),
    keyboard: rectBox(12, 79, 148, 83),
    mouse: rectBox(53, 253, 60, 94),
    monitor: rectBox(733, 60, 154, 105),
    speakers: rectBox(739, 269, 137, 106),
  };
  const soc = rectBox(253, 64, 432, 259.2);
  if (unified)
    Object.assign(layout, { rom: rectBox(288, 346, 78, 68), io: rectBox(550, 356, 65, 65) });
  let b = '';
  b += P(
    'M 158 119 H 174 V 132 H 190 M 83 259 V 228 H 172 V 288 H 190 M 704 141 H 720 V 103 H 733 M 704 324 H 739',
    'cable',
  );
  b +=
    R(board.x + 4, board.y + 4, board.w, board.h, 'shadow outline', 9) +
    R(board.x, board.y, board.w, board.h, 'board outline', 9);
  b += R(board.x + 9, board.y + 9, board.w - 18, board.h - 18, 'trace', 5);
  for (const [x, y] of [
    [board.x + 15, board.y + 15],
    [board.x + board.w - 15, board.y + 15],
    [board.x + 15, board.y + board.h - 15],
    [board.x + board.w - 15, board.y + board.h - 15],
  ])
    b += C(x, y, 6, 'gold fine') + C(x, y, 3, 'paper fine');
  if (unified) {
    b += P(
      'M 190 132 H 242 V 379 H 550 M 190 288 H 230 V 397 H 550 M 366 385 H 550 M 582 356 V 328 H 500 V 304 M 535 267 V 334 H 694 V 141 H 704 M 615 391 H 684 V 324 H 704',
      'trace',
    );
  } else {
    b += repeat(6, (i) =>
      P(`M 418 ${108 + i * 5} H ${437 + i * 5} V ${95 + i * 5} H 476`, 'trace'),
    );
    b += repeat(5, (i) =>
      P(`M ${368 + i * 5} 212 V ${224 + i * 5} H ${511 + i * 3} V ${294 + i * 5} H 514`, 'trace'),
    );
    b += P(
      'M 347 218 V 255 H 417 V 270 M 376 339 H 391 M 391 293 H 242 V 132 H 190 M 391 312 H 230 V 288 H 190 M 644 330 H 688 V 141 H 704 M 417 335 V 393 H 680 V 324 H 704',
      'trace',
    );
    b += T(455, 216, 'PCIe', 12);
  }
  b +=
    R(182, 119, 22, 29, 'metal outline', 2) +
    R(182, 275, 22, 29, 'metal outline', 2) +
    R(696, 131, 16, 23, 'metal outline', 2) +
    C(702, 324, 6, 'metal outline');
  b += repeat(
    6,
    (i) =>
      passive(board.x + 50 + i * 19, board.y + 24, 12, 6) +
      via(board.x + 47 + i * 19, board.y + 37),
  );
  b += repeat(
    4,
    (i) =>
      R(board.x + 29, board.y + 55 + i * 22, 17, 15, 'chip fine', 2) +
      R(board.x + 49, board.y + 58 + i * 22, 8, 9, 'metal fine', 1),
  );
  const place = (key, label, draw, source, type = key) => {
    const box = layout[key];
    b += placedArt(
      key,
      draw({ T: () => '', mini: false, inside: false, display }).body,
      source,
      box,
    );
    b += T(box.x + box.w / 2, box.y + box.h + 18, label, 16, 'node-title');
    H(key, label, type, box.x - 3, box.y - 3, box.w + 6, box.h + 28);
  };
  if (unified) {
    const s = soc.w / 600;
    b += G(
      'soc',
      unifiedAssembly({ T: () => '' }).body,
      `translate(${soc.x} ${soc.y}) scale(${s})`,
    );
    H('soc', 'SoC и общая память', 'soc', soc.x, soc.y, soc.w, soc.h);
    unifiedTargets(H, soc);
    for (const [x, y, label] of [
      [231, 71, 'CPU'],
      [362, 71, 'GPU'],
      [300, 320, 'SoC'],
    ])
      b += T(soc.x + x * s, soc.y + y * s, label, 16, 'node-title');
    unifiedLayout.lpddr.forEach((p) => {
      b += T(soc.x + (p.x + p.w / 2) * s, soc.y + (p.y + p.h * 0.43) * s, 'LPDDR', 13, 'etch');
    });
  } else {
    place('cpu', 'CPU', cpuPackage, sceneBoxes.cpu);
    const graphics = layout.graphics,
      gs = graphics.w / 360,
      gx = graphics.x,
      gy = graphics.y;
    b += G(
      'graphics',
      graphicsAssembly({ T: () => '', mini: false }, 'gpu').body,
      `translate(${gx} ${gy}) scale(${gs})`,
    );
    const g = graphicsLayout.gpu;
    H('gpu', 'GPU', 'gpu', gx + g.x * gs, gy + g.y * gs, g.w * gs, g.h * gs + 22);
    b +=
      T(gx + 180 * gs, gy + 260 * gs, 'GPU', 16, 'node-title') +
      T(gx + 315.5 * gs, gy + 260 * gs, 'VRAM', 14, 'node-title');
    graphicsLayout.vram.forEach((p, i) =>
      H(
        `vram-${i}`,
        `VRAM ${i + 1} · GDDR`,
        'vram',
        gx + p.x * gs,
        gy + p.y * gs,
        p.w * gs,
        p.h * gs,
      ),
    );
    place('ram', 'RAM', ram, sceneBoxes.ram);
  }
  place('rom', 'ROM', flashPackage, sceneBoxes.rom);
  const io = layout.io;
  b +=
    G(
      'io',
      repeat(
        7,
        (i) =>
          pin(io.x - 7, io.y + 5 + i * 8, 7, 4) +
          pin(io.x + io.w, io.y + 5 + i * 8, 7, 4) +
          pin(io.x + 5 + i * 8, io.y - 7, 4, 7) +
          pin(io.x + 5 + i * 8, io.y + io.h, 4, 7),
      ) + R(io.x, io.y, io.w, io.h, 'chip outline', 3),
    ) + T(io.x + io.w / 2, io.y + io.h / 2, 'I/O', 17, 'etch');
  H('io', 'Контроллер I/O', 'io-hub', io.x - 7, io.y - 7, io.w + 14, io.h + 14);
  b += boardStorage({ T, H, io });
  place('keyboard', 'Клавиатура', keyboardArt, sceneBoxes.keyboard);
  place('mouse', 'Мышь', mouseArt, sceneBoxes.mouse);
  place('monitor', 'Монитор', monitorArt, sceneBoxes.monitor);
  place('speakers', 'Колонки', speakerArt, sceneBoxes.speakers);
  scene.body = b;
  scene.caption = unified
    ? 'CPU и GPU внутри SoC используют общую LPDDR. Открой любой блок, микросхему памяти или подключённое устройство.'
    : 'Открой компонент на плате или подключённое устройство.';
  return scene;
}
export { boardScene };
