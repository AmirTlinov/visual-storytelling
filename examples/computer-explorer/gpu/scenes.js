import { rectBox, placedArt, sceneBoxes } from '../drawing/geometry.js';
import { R, P, C, repeat, gpuPackage, gpuDie, G } from '../drawing/symbols.js';
const graphicsLayout = {
  gpu: rectBox(67, 33, 225, 214),
  vram: [
    rectBox(18, 59, 53, 66),
    rectBox(18, 155, 53, 66),
    rectBox(289, 59, 53, 66),
    rectBox(289, 155, 53, 66),
  ],
};
function dramPackage({ T }, technology = 'GDDR') {
  let b = R(4, 5, 92, 116, 'shadow outline', 4) + R(0, 0, 94, 116, 'chip outline', 4);
  b += P('M 7 105 V 13 L 13 6 H 83 M 87 13 V 105', 'engraving') + C(12, 16, 3, 'metal-hi');
  b += T(47, 48, technology, 15, 'etch') + P('M 20 71 H 74 M 20 78 H 65 M 20 85 H 68', 'engraving');
  return { body: b };
}
function graphicsAssembly(ctx, packageKey = 'die') {
  let body = '';
  graphicsLayout.vram.forEach((box, i) => {
    const left = i < 2,
      edge = left ? box.x + box.w : box.x,
      contact = left ? 79 : 281;
    body += repeat(5, (n) =>
      P(
        `M ${edge} ${box.y + 18 + n * 6} H ${(edge + contact) / 2 + (left ? 1 : -1) * n * 1.5} V ${box.y + 20 + n * 6} H ${contact}`,
        'trace',
      ),
    );
    body += placedArt(`vram-${i}`, dramPackage({ ...ctx, T: () => '' }).body, sceneBoxes.vram, box);
  });
  body += placedArt(
    packageKey,
    gpuPackage({ ...ctx, inside: false }).body,
    sceneBoxes['gpu-package'],
    graphicsLayout.gpu,
  );
  body += ctx.T(180, 260, 'GPU', 16) + ctx.T(315.5, 260, 'VRAM', 15);
  return { body };
}
const gpuSceneTypes = new Set(['gpu', 'gpu-die', 'vram', 'memory-controller']);
function gpuScene(node, { scene, T, H, ctx, array, tile, unified }) {
  if (node.type === 'gpu') {
    scene.body = graphicsAssembly(ctx).body;
    const p = graphicsLayout.gpu;
    H('die', 'Кристалл GPU', 'gpu-die', p.x, p.y, p.w, p.h);
    graphicsLayout.vram.forEach((p, i) =>
      H(`vram-${i}`, `VRAM ${i + 1} · GDDR`, 'vram', p.x, p.y, p.w, p.h),
    );
    scene.caption =
      'Отдельные чипы GDDR соединены с GPU шиной памяти. Открой кристалл GPU или любой чип VRAM.';
  } else if (node.type === 'gpu-die') {
    scene.body = gpuDie({ ...ctx, inside: true }).body;
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 4; col++)
        H(
          `sm-${row * 4 + col}`,
          `${unified ? 'Кластер' : 'SM'} ${row * 4 + col}`,
          'sm',
          120 + col * 31,
          84 + row * 24,
          27,
          20,
        );
    H('l2', 'Кэш L2', 'cache-level', 120, 134, 120, 14);
    H(
      'memory',
      unified ? 'Доступ GPU к общей памяти' : 'Контроллеры GDDR',
      unified ? 'system-fabric' : 'memory-controller',
      120,
      153,
      unified ? 120 : 76,
      12,
    );
    if (!unified) H('display', 'Вывод кадра: VRAM → монитор', 'display-scanout', 202, 153, 38, 12);
    scene.caption = unified
      ? 'Кластеры GPU и кэш L2 подключены к fabric SoC. Через него GPU обращается к общей LPDDR; контроллер дисплея — отдельный блок SoC.'
      : 'SM вычисляют, L2 и контроллеры обслуживают память; DISP считывает готовый кадр из VRAM и передаёт его монитору.';
  } else if (node.type === 'vram') {
    scene.body = G('die', dramPackage(ctx).body);
    H('die', 'Банки GDDR', 'dram', 0, 0, 98, 122, { memory: 'gddr' });
    scene.caption =
      'VRAM — графическая DRAM в корпусе BGA; контакты находятся снизу. Внутри — банки динамических ячеек.';
  } else if (node.type === 'memory-controller') {
    const technology = unified ? 'LPDDR' : 'GDDR';
    let b = G('l2', array(48, 111, 119, 132, 4, 5)) + T(107, 85, unified ? 'SLC' : 'L2', 17);
    b += P('M 167 177 H 289 M 364 177 H 412 M 528 177 H 573', 'line');
    b +=
      G('queue', tile(216, 72, 148, 71, 'Очередь')) +
      G('schedule', tile(216, 194, 148, 78, 'Команды'));
    b +=
      P('M 289 143 V 194 M 364 233 H 385 V 177 M 364 108 H 385 V 177') +
      C(289, 177, 3, 'dot') +
      C(385, 177, 3, 'dot');
    b +=
      R(412, 111, 116, 132, 'metal outline', 4) +
      T(470, 158, technology, 14) +
      T(470, 191, 'PHY', 14) +
      T(557, 151, unified ? 'RAM' : 'VRAM', 13);
    b += T(289, 292, 'READ · WRITE · REFRESH', 12);
    H('l2', unified ? 'Системный кэш' : 'Кэш L2', 'cache-level', 48, 111, 119, 132);
    H('queue', 'Очередь запросов', 'register-file', 216, 72, 148, 71);
    H('schedule', 'Управляющая логика', 'controller', 216, 194, 148, 78);
    scene.body = b;
    scene.caption = `Контроллер планирует чтение, запись и обновление DRAM; PHY передаёт сигналы внешним чипам ${technology}.`;
  }
  return scene;
}
export { gpuSceneTypes, gpuScene, dramPackage, graphicsAssembly, graphicsLayout };
