import { rectBox, placedArt, sceneBoxes } from '../drawing/geometry.js';
import { P, R, repeat, via, passive, cpuDie, gpuDie, G } from '../drawing/symbols.js';
import { dramPackage } from '../gpu/scenes.js';
import { displayRaster } from '../display/scenes.js';
const unifiedLayout = {
  cpu: rectBox(176, 60, 110, 140),
  gpu: rectBox(300, 60, 124, 140),
  fabric: rectBox(176, 211, 248, 28),
  cache: rectBox(176, 248, 94, 34),
  memory: rectBox(281, 248, 66, 34),
  display: rectBox(358, 248, 66, 34),
  lpddr: [
    rectBox(39, 61, 91, 112),
    rectBox(39, 195, 91, 112),
    rectBox(470, 61, 91, 112),
    rectBox(470, 195, 91, 112),
  ],
};
function unifiedTargets(H, box = rectBox(0, 0, 600, 360)) {
  const scale = box.w / 600;
  const hit = (key, label, type, p) =>
    H(key, label, type, box.x + p.x * scale, box.y + p.y * scale, p.w * scale, p.h * scale);
  hit('cpu', 'CPU · SoC', 'cpu-die', unifiedLayout.cpu);
  hit('gpu', 'GPU · SoC', 'gpu-die', unifiedLayout.gpu);
  hit('fabric', 'Системная связь · fabric', 'system-fabric', unifiedLayout.fabric);
  hit('cache', 'Системный кэш SLC', 'cache-level', unifiedLayout.cache);
  hit('memory', 'Контроллер LPDDR', 'memory-controller', unifiedLayout.memory);
  hit('display', 'Контроллер дисплея', 'display-scanout', unifiedLayout.display);
  unifiedLayout.lpddr.forEach((p, i) =>
    hit(`lpddr-${i}`, `LPDDR ${i + 1} · общая память`, 'lpddr', p),
  );
}
function unifiedAssembly(ctx) {
  const { T } = ctx;
  let b = P('M 31 21 H 573 L 585 33 V 333 L 573 345 H 31 L 19 333 V 33 Z', 'shadow outline');
  b += P('M 28 17 H 570 L 582 29 V 329 L 570 341 H 28 L 16 329 V 29 Z', 'board outline');
  b += R(26, 27, 546, 304, 'trace', 4) + P('M 26 312 v 16 h 16', 'edge');
  b += repeat(20, (i) => via(40 + i * 27, 33) + via(40 + i * 27, 326));
  b += repeat(8, (i) => passive(139, 53 + i * 32, 10, 5) + passive(451, 53 + i * 32, 10, 5));
  unifiedLayout.lpddr.forEach((p, i) => {
    const left = i < 2,
      edge = left ? p.x + p.w : p.x,
      contact = left ? 156 : 444;
    b += repeat(7, (n) =>
      P(
        `M ${edge} ${p.y + 29 + n * 8} H ${(edge + contact) / 2} V ${p.y + 32 + n * 8} H ${contact}`,
        'trace',
      ),
    );
    b += placedArt(`lpddr-${i}`, dramPackage(ctx, 'LPDDR').body, sceneBoxes.lpddr, p);
  });
  b += R(156, 40, 288, 264, 'metal outline', 3) + R(163, 47, 274, 250, 'die-dark fine', 2);
  b += placedArt(
    'cpu',
    cpuDie({ ...ctx, T: () => '', unified: false }).body,
    sceneBoxes['cpu-die'],
    rectBox(176, 80, 110, 114),
  );
  b += placedArt(
    'gpu',
    gpuDie({ ...ctx, T: () => '', unified: true }).body,
    sceneBoxes['gpu-die'],
    rectBox(300, 83, 124, 112),
  );
  b += T(231, 71, 'CPU', 17) + T(362, 71, 'GPU', 17);
  b += repeat(4, (i) => P(`M ${207 + i * 10} 194 V 211 M ${344 + i * 10} 195 V 211`, 'trace'));
  b +=
    G(
      'fabric',
      R(176, 211, 248, 28, 'metal-hi fine', 1) +
        repeat(15, (i) => P(`M ${184 + i * 16} 215 v 5 M ${184 + i * 16} 230 v 5`, 'micro')),
    ) + T(300, 225, 'FABRIC', 15);
  for (const [key, label, kind] of [
    ['cache', 'SLC', 'chip'],
    ['memory', 'MC', 'die'],
    ['display', 'DISP', 'metal-hi'],
  ]) {
    const p = unifiedLayout[key],
      mid = p.x + p.w / 2;
    b += P(`M ${mid} 239 V ${p.y}`, 'trace');
    b += G(
      key,
      R(p.x, p.y, p.w, p.h, `${kind} fine`, 1) +
        (key === 'cache' ? repeat(6, (i) => R(p.x + 5 + i * 14, p.y + 4, 10, 8, 'die', 0.5)) : ''),
    );
    b += T(mid, p.y + (key === 'cache' ? 26 : 17), label, 12, key === 'cache' ? 'etch' : '');
  }
  b += T(300, 320, 'SoC', 18);
  return { body: b };
}
const unifiedSceneTypes = new Set(['soc', 'unified-memory', 'system-fabric', 'lpddr']);
function unifiedScene(node, { scene, T, H, ctx, array, bus, arrow, display }) {
  let b = '';
  if (node.type === 'soc') {
    b = unifiedAssembly(ctx).body;
    unifiedTargets(H);
    scene.caption =
      'CPU, GPU, системный кэш и контроллеры — на одном кристалле. Микросхемы LPDDR рядом с ним образуют общую память. Учебный SoC, расположение блоков условное.';
  } else if (node.type === 'lpddr') {
    b = G('die', dramPackage(ctx, 'LPDDR').body);
    H('die', 'Банки LPDDR', 'dram', 0, 0, 98, 122, { memory: 'lpddr' });
    scene.caption =
      'LPDDR — динамическая память в отдельном корпусе BGA. Через контроллер SoC к ней обращаются и CPU, и GPU.';
  } else if (node.type === 'unified-memory') {
    b += placedArt(
      'cpu',
      cpuDie({ ...ctx, T: () => '', unified: false }).body,
      sceneBoxes['cpu-die'],
      rectBox(65, 16, 104, 90),
    );
    b += placedArt(
      'gpu',
      gpuDie({ ...ctx, T: () => '' }).body,
      sceneBoxes['gpu-die'],
      rectBox(430, 16, 104, 90),
    );
    b += T(190, 50, 'CPU', 16) + T(409, 50, 'GPU', 16);
    b += R(241, 37, 118, 47, 'metal outline', 3) + T(300, 61, 'FABRIC', 15);
    b +=
      bus(169, 70, 241, 70) +
      arrow(236, 70) +
      arrow(175, 70, 'left') +
      bus(359, 70, 430, 70) +
      arrow(424, 70) +
      arrow(365, 70, 'left');
    b += bus(300, 84, 300, 128) + arrow(300, 121, 'down') + arrow(300, 91, 'up');
    b += R(42, 128, 516, 209, 'board outline', 5) + T(300, 146, 'ОБЩАЯ LPDDR', 17);
    for (let i = 0; i < 4; i++) {
      const box = rectBox(79 + i * 123, 169, 73, 80);
      b += placedArt(
        `lpddr-${i}`,
        dramPackage({ ...ctx, T: () => '' }, 'LPDDR').body,
        sceneBoxes.lpddr,
        box,
      );
      H(`lpddr-${i}`, `LPDDR ${i + 1}`, 'lpddr', box.x, box.y, box.w, box.h);
    }
    b += G(
      'framebuffer',
      R(73, 264, 454, 60, 'paper fine', 3) +
        displayRaster(display, rectBox(83, 270, 100, 50), 'vram'),
    );
    b += T(356, 283, 'Кадр · RGB888', 17) + T(356, 308, 'Те же байты для CPU и GPU', 14);
    H('framebuffer', 'Общий буфер кадра', 'display-framebuffer', 73, 264, 454, 60);
    scene.caption =
      'CPU и GPU используют один буфер в общей памяти. Нажми на кадр: изменение его байтов станет видно на LCD после развёртки. Доступ процессоров требует синхронизации.';
  } else if (node.type === 'system-fabric') {
    b = placedArt(
      'cpu',
      cpuDie({ ...ctx, T: () => '', unified: false }).body,
      sceneBoxes['cpu-die'],
      rectBox(39, 25, 118, 104),
    );
    b += placedArt(
      'gpu',
      gpuDie({ ...ctx, T: () => '' }).body,
      sceneBoxes['gpu-die'],
      rectBox(443, 25, 118, 104),
    );
    b += T(98, 148, 'CPU', 17) + T(502, 148, 'GPU', 17);
    b +=
      bus(157, 85, 210, 85) +
      arrow(204, 85) +
      arrow(163, 85, 'left') +
      bus(390, 85, 443, 85) +
      arrow(437, 85) +
      arrow(396, 85, 'left');
    b += R(210, 70, 180, 64, 'metal outline', 3) + T(300, 102, 'FABRIC', 20);
    b +=
      bus(300, 134, 300, 168) +
      G('cache', array(210, 168, 180, 45, 2, 12) + R(272, 179, 56, 23, 'chip', 1)) +
      T(300, 190, 'SLC', 16, 'etch');
    H('cache', 'Общий системный кэш', 'cache-level', 210, 168, 180, 45);
    b +=
      bus(300, 213, 300, 245) +
      G('controller', R(210, 245, 180, 62, 'chip outline', 3)) +
      T(300, 267, 'LPDDR', 16, 'etch') +
      T(300, 289, 'Контроллер / PHY', 13, 'etch');
    H('controller', 'Контроллер LPDDR', 'memory-controller', 210, 245, 180, 62);
    b += bus(170, 276, 210, 276) + arrow(177, 276, 'left') + arrow(204, 276);
    b +=
      G(
        'memory',
        R(39, 245, 131, 62, 'board outline', 3) +
          repeat(4, (i) => R(48 + i * 29, 253, 24, 19, 'chip fine', 1)),
      ) + T(104, 293, 'Общая память', 14);
    H('memory', 'Общая память CPU / GPU', 'unified-memory', 39, 245, 131, 62);
    b += P('M 390 112 H 413 V 276 H 430', 'line') + arrow(424, 276);
    b +=
      G('display', R(430, 245, 131, 62, 'metal outline', 3)) +
      T(495, 267, 'DISPLAY', 16) +
      T(495, 289, 'Вывод кадра', 13);
    H('display', 'Общая память → монитор', 'display-scanout', 430, 245, 131, 62);
    scene.caption =
      'Fabric связывает блоки SoC и согласует доступ к памяти. SLC — системный кэш; LPDDR хранит общие данные. Программа синхронизирует завершение работы CPU и GPU.';
  }
  scene.body = b;
  return scene;
}
export { unifiedSceneTypes, unifiedScene, unifiedAssembly, unifiedTargets, unifiedLayout };
