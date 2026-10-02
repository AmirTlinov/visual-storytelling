import { ram, repeat, G, R, P, cpuPackage, gpuPackage } from '../drawing/symbols.js';
import { colorRect } from '../display/scenes.js';
import { imageProgram } from './model.js';
import { placedArt, sceneBoxes, rectBox } from '../drawing/geometry.js';
import { nvmeSsdArt } from '../storage/art.js';
import { dramPackage } from '../gpu/scenes.js';

const imageHex = (value) =>
  value === null ? '—' : value.toString(16).toUpperCase().padStart(2, '0');
const imageAddress = (value) => '0x' + value.toString(16).toUpperCase().padStart(4, '0');
function imageJobScene(node, job, { scene, T, H, arrow }) {
  let b = '';
  const picture = (bytes, x, y, w, h) =>
    repeat(4, (row) =>
      repeat(8, (col) => {
        const v = bytes[row * 8 + col],
          color = v === null ? 'var(--p-soft)' : `rgb(${v} ${v} ${v})`;
        return colorRect(x + (col * w) / 8, y + (row * h) / 4, w / 8, h / 4, color);
      }),
    );
  const bytes = (location, x, y) => {
    const buffer = job.buffer(location);
    return repeat(32, (i) => {
      const xx = x + (i % 8) * 64,
        yy = y + Math.floor(i / 8) * 46,
        v = buffer[i];
      H(
        `byte-${i}`,
        `${location === 'ssd' ? 'SSD' : location === 'gpu' ? 'GPU' : 'RAM'} · ${imageAddress(job.address(location, i))} = ${v ?? 'не загружен'}`,
        'image-byte',
        xx,
        yy,
        58,
        38,
        { location, index: i },
      );
      return G(
        `byte-${i}`,
        R(
          xx,
          yy,
          58,
          38,
          `paper ${location === 'ram' && job.phase === 'cpu' && i === job.cpu.r1 - 0x1000 ? 'job-selected' : 'fine'}`,
          3,
        ) + T(xx + 29, yy + 19, imageHex(v), 18, 'mono'),
      );
    });
  };
  if (node.type === 'image-ssd') {
    b = placedArt(
      'hardware',
      nvmeSsdArt({ T: () => '' }).body,
      sceneBoxes['m2-module'],
      rectBox(44, 30, 302, 85),
    );
    H('hardware', 'Устройство SSD NVMe', 'nvme-ssd', 44, 30, 302, 85, { drive: 'nvme' });
    b +=
      T(192, 133, 'NVMe · READ', 17) +
      picture(job.source, 395, 32, 152, 76) +
      T(471, 132, '8 × 4 · Gray8', 16);
    b +=
      P('M 75 169 H 524', 'line') +
      arrow(524, 169) +
      T(99, 157, 'SQ', 14) +
      T(270, 157, 'NAND → DMA', 14) +
      T(497, 157, 'CQ', 14);
    b += bytes('ssd', 47, 191);
    scene.caption =
      'Показаны 32 байта изображения внутри одного логического блока. FTL связывает их с уменьшенными блоками NAND. Нажми на байт, затем на его физические ячейки.';
  } else if (node.type === 'image-ram') {
    b = placedArt(
      'hardware',
      job.unified
        ? dramPackage({ T: () => '' }, 'LPDDR').body
        : ram({ T: () => '', mini: false }).body,
      job.unified ? sceneBoxes.lpddr : sceneBoxes.ram,
      rectBox(45, 20, 241, 111),
    );
    H(
      'hardware',
      job.unified ? 'Устройство LPDDR' : 'Устройство RAM',
      job.unified ? 'lpddr' : 'ram',
      45,
      20,
      241,
      111,
    );
    b += T(170, 156, job.unified ? 'Общий буфер CPU / GPU' : 'Буфер CPU · RAM', 17);
    b += picture(job.ram, 379, 30, 160, 80) + T(459, 132, '0x1000 · 32 B', 16, 'mono');
    b += bytes('ram', 47, 191);
    scene.caption =
      'Каждый байт имеет собственный адрес и значение. CPU читает его в R0, прибавляет 16 с ограничением 255 и записывает обратно. Открой байт, чтобы дойти до его отдельного бита.';
  } else if (node.type === 'image-cpu') {
    b = placedArt(
      'hardware',
      cpuPackage({ T: () => '', mini: false }).body,
      sceneBoxes.cpu,
      rectBox(42, 23, 72, 75),
    );
    H('hardware', 'Устройство CPU', 'cpu', 42, 23, 72, 75);
    const c = job.cpu,
      stage = { fetch: 'ВЫБОРКА', decode: 'ДЕКОДИРОВАНИЕ', execute: 'ИСПОЛНЕНИЕ' }[c.phase];
    b +=
      T(318, 35, job.phase === 'cpu' ? stage : 'ПРОГРАММА CPU', 19) +
      T(
        318,
        70,
        `PC ${c.pc} · IR ${c.ir === null ? '—' : imageProgram[c.ir][0]} · ${c.instructions} / 224`,
        16,
        'mono',
      );
    imageProgram.forEach(([op, args], i) => {
      const y = 115 + i * 35;
      b +=
        R(
          44,
          y,
          307,
          30,
          i === c.pc && job.phase === 'cpu' ? 'soft job-selected' : 'paper fine',
          2,
        ) +
        T(59, y + 15, String(i), 14, 'mono', 'start') +
        T(90, y + 15, `${op} ${args}`, 16, 'mono', 'start');
    });
    b += G(
      'ram',
      R(380, 119, 175, 171, 'board outline', 5) +
        T(467, 146, 'Регистры', 18) +
        T(467, 188, `R0 = ${c.r0}`, 18, 'mono') +
        T(467, 226, `R1 = ${imageAddress(c.r1)}`, 16, 'mono') +
        T(467, 266, c.less ? 'LT = 1' : 'LT = 0', 17, 'mono'),
    );
    H('ram', 'Операнды в памяти', 'image-ram', 380, 119, 175, 171);
    b +=
      P('M 351 189 H 380', 'line') +
      arrow(375, 189) +
      T(462, 327, `${Math.min(32, Math.floor(c.instructions / 7))} / 32 байта`, 16);
    scene.caption =
      'Учебная программа: LOAD → ADD → MIN → STORE → INC → CMP → JLT. Шаг выполняет выборку, декодирование или исполнение одной команды. R0 временно хранит сумму до ограничения диапазона.';
  } else if (node.type === 'image-gpu') {
    b = placedArt(
      'hardware',
      gpuPackage({ T: () => '', mini: false }).body,
      sceneBoxes['gpu-package'],
      rectBox(35, 24, 80, 78),
    );
    H('hardware', 'Устройство GPU', job.unified ? 'gpu-die' : 'gpu', 35, 24, 80, 78);
    b +=
      T(336, 34, `GPU · группа ${Math.min(4, job.gpu.group + 1)} / 4`, 19) +
      T(336, 69, 'R = v · G = ⌊3v/4⌋ · B = 255 − v', 16);
    const start = Math.min(3, job.gpu.group) * 8,
      buffer = job.gpuInput;
    for (let lane = 0; lane < 8; lane++) {
      const x = 41 + lane * 65,
        i = start + lane,
        loaded = job.gpu.loaded[lane],
        rgb = job.gpu.colors[lane];
      b += G(
        `lane-${lane}`,
        R(x, 113, 59, 158, 'chip outline', 4) +
          T(x + 29, 135, `T${i}`, 16, 'etch') +
          T(x + 29, 173, imageHex(loaded ?? null), 17, 'etch mono') +
          P(`M ${x + 29} 195 v 20`, 'edge') +
          arrow(x + 29, 215, 'down') +
          (rgb
            ? colorRect(x + 8, 232, 43, 25, `rgb(${rgb.join(' ')})`)
            : R(x + 8, 232, 43, 25, 'metal', 1)),
      );
      H(
        `lane-${lane}`,
        `Поток ${i} · вход ${buffer[i] ?? 'не загружен'}`,
        'image-byte',
        x,
        113,
        59,
        158,
        { location: 'gpu', index: i },
      );
    }
    b += G(
      'framebuffer',
      R(44, 302, 512, 62, 'board outline', 4) +
        T(300, 321, job.unified ? 'Кадр в общей LPDDR' : 'Кадр в VRAM', 17) +
        T(300, 346, `${job.gpu.written} / 32 участка · 24 × 12 RGB888`, 14),
    );
    H('framebuffer', 'Буфер результата GPU', 'display-framebuffer', 44, 302, 512, 62);
    scene.caption =
      (job.unified
        ? 'Потоки читают тот же буфер LPDDR, который изменил CPU.'
        : 'Потоки читают копию буфера в VRAM после передачи по PCIe.') +
      ' Показаны группы по 8 учебных потоков; каждый записывает участок 3 × 3 пикселя. Размер группы не задаёт аппаратный размер warp.';
  } else if (node.type === 'image-byte') {
    const { location, index } = node,
      buffer = job.buffer(location),
      value = buffer[index];
    b = T(
      300,
      35,
      `${location === 'ssd' ? 'SSD' : location === 'gpu' ? (job.unified ? 'GPU · LPDDR' : 'GPU · VRAM') : job.unified ? 'CPU · LPDDR' : 'CPU · RAM'} · ${imageAddress(job.address(location, index))}`,
      20,
    );
    b += T(300, 79, `${value ?? '—'} · HEX ${imageHex(value)}`, 23, 'mono');
    for (let col = 0; col < 8; col++) {
      const bit = 7 - col,
        x = 41 + col * 65,
        v = value === null ? null : (value >> bit) & 1;
      b += G(
        `bit-${bit}`,
        R(x, 133, 58, 89, v ? 'board outline' : 'paper outline', 3) +
          T(x + 29, 151, `b${bit}`, 14) +
          T(x + 29, 190, v ?? '—', 24, 'mono'),
      );
      if (location === 'ssd')
        H(`bit-${bit}`, `NAND · бит ${bit}`, 'nand-cell', x, 133, 58, 89, {
          ...job.physical(index),
          col: bit,
        });
      else if (value !== null)
        H(`bit-${bit}`, `DRAM · бит ${bit}`, 'dram-cell', x, 133, 58, 89, {
          imageLocation: location,
          imageByte: index,
          imageBit: bit,
        });
    }
    b += T(300, 260, `Пиксель источника (${index % 8}, ${Math.floor(index / 8)})`, 17);
    if (location === 'ssd') {
      const a = job.physical(index);
      b += T(
        300,
        301,
        `FTL → NAND ${a.chip + 1} · D${a.die} · plane ${a.plane} · B${a.block} · WL${a.row}`,
        16,
      );
      scene.caption =
        'Это те же физические ячейки NAND, которые читает контроллер. Изменение бита повлияет на следующий запуск чтения; уже переданные в RAM данные сохраняются.';
    } else {
      b += T(
        300,
        303,
        job.unified
          ? 'CPU и GPU обращаются к одному массиву байтов'
          : location === 'gpu'
            ? 'Копия в VRAM · адресное пространство GPU'
            : 'Исходный рабочий буфер CPU',
        16,
      );
      scene.caption =
        value === null
          ? 'Данные ещё не поступили. Продолжи сценарий до завершения DMA или копирования в VRAM.'
          : 'Открой отдельный бит: заряд его DRAM-ячейки связан с этим байтом. Изменение заряда меняет значение в памяти и последующее вычисление.';
    }
  }
  scene.body = b;
  return scene;
}
function imageJobBoard(scene, job) {
  if (!job.active) return scene;
  const memory = job.unified ? 'memory' : 'ram';
  const targets = {
    nvme: ['image-ssd', 'SSD · данные сценария'],
    cpu: ['image-cpu', 'CPU · программа'],
    gpu: ['image-gpu', 'GPU · потоки'],
    [memory]: ['image-ram', job.unified ? 'Общая LPDDR · данные' : 'RAM · данные'],
  };
  for (const hit of scene.hits)
    if (targets[hit.key]) {
      const [type, label] = targets[hit.key];
      hit.node = { type, label };
      hit.label = label;
    }
  const keys =
    job.phase === 'dma'
      ? ['nvme', memory]
      : job.phase === 'complete'
        ? [memory]
        : job.phase === 'upload'
          ? [memory, 'gpu']
          : job.stage === 'ssd'
            ? ['nvme']
            : job.stage === 'cpu'
              ? ['cpu']
              : job.stage === 'gpu'
                ? ['gpu']
                : ['monitor'];
  for (const key of keys)
    scene.body = scene.body.replace(
      `data-part="${key}"`,
      `data-part="${key}" data-job-active="true"`,
    );
  return scene;
}
export { imageJobScene, imageAddress, imageJobBoard };
