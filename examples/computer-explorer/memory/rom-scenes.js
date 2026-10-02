import { R, G, P, repeat, C } from '../drawing/symbols.js';
import { flashPackage } from '../io/art.js';
import { norArray } from './arrays.js';
const romSceneTypes = new Set(['rom', 'rom-die', 'flash-array', 'flash-cell', 'floating-gate']);
function romScene(node, values, { scene, T, H, array, bus, ctx, control }) {
  let b = '';
  if (node.type === 'rom') {
    b = flashPackage(ctx).body;
    H('die', 'Кристалл NOR Flash', 'rom-die', 120, 58, 120, 134);
    scene.caption =
      'ROM хранит прошивку. На этой плате её роль выполняет перезаписываемая SPI NOR Flash.';
  } else if (node.type === 'rom-die') {
    b = R(46, 25, 508, 302, 'chip outline', 6) + R(57, 36, 486, 280, 'board fine', 2);
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 2; col++) {
        const x = 79 + col * 203,
          y = 52 + row * 103,
          sector = row * 2 + col;
        b +=
          G(`sector-${sector}`, array(x, y, 176, 72, 4, 12)) +
          T(x + 88, y + 87, `Сектор ${sector}`, 13);
        H(`sector-${sector}`, `Сектор ${sector}`, 'flash-array', x, y, 176, 72, { sector });
      }
    b +=
      G('spi', R(80, 270, 175, 27, 'metal-hi fine', 2)) +
      T(167, 283, 'SPI', 14) +
      G('decoder', R(283, 270, 176, 27, 'metal-hi fine', 2)) +
      T(371, 283, 'ДЕКОДЕР', 13);
    H('spi', 'Интерфейс SPI', 'controller', 80, 266, 175, 35);
    H('decoder', 'Декодер адреса', 'decoder', 283, 266, 176, 35);
    scene.caption =
      'Интерфейс принимает адрес, декодер выбирает данные в матрице энергонезависимых ячеек.';
  } else if (node.type === 'flash-array') {
    return norArray(node, { scene, T, H });
  } else if (node.type === 'flash-cell') {
    const bit = node.bit ?? 0,
      charged = bit === 0;
    b =
      R(57, 193, 486, 116, 'board outline', 4) +
      P(
        'M 83 193 H 204 V 224 Q 204 245 183 245 H 104 Q 83 245 83 224 Z M 397 193 H 518 V 224 Q 518 245 497 245 H 418 Q 397 245 397 224 Z',
        'die fine',
      );
    b +=
      G(
        'floating-gate',
        R(204, 108, 193, 83, 'gold fine', 3) + R(227, 119, 147, 26, 'metal outline', 2),
      ) +
      R(226, 74, 149, 23, 'metal outline', 2) +
      bus(300, 47, 300, 74);
    b +=
      R(131, 163, 24, 31, 'metal fine', 1) +
      R(444, 163, 24, 31, 'metal fine', 1) +
      P('M 143 163 V 156 H 95 M 456 163 V 156 H 512') +
      T(117, 141, 'SOURCE', 12) +
      T(481, 141, 'DRAIN', 12);
    b += repeat(9, (i) => P(`M ${76 + i * 54} 299 l 8 -8`, 'micro'));
    b +=
      T(300, 28, 'УПРАВЛЯЮЩИЙ ЗАТВОР', 14) +
      T(497, 74, 'ПЛАВАЮЩИЙ', 12) +
      T(497, 105, 'ЗАТВОР', 12) +
      P('M 374 132 H 405 V 92 H 427', 'leader') +
      T(143, 220, 'n+', 16) +
      T(456, 220, 'n+', 16) +
      T(300, 277, 'p-Si', 15);
    if (charged) b += repeat(7, (i) => C(240 + i * 20, 132, 3.5, 'charge'));
    if (values.romPower && !charged) b += P('M 204 203 H 397', 'active-path');
    b += T(300, 335, `Сохранённый бит: ${bit}`, 17);
    H('floating-gate', 'Плавающий затвор', 'floating-gate', 205, 108, 192, 82, { bit });
    scene.control = control('romPower', 'Питание ROM: включено', 'Питание ROM: отключено');
    scene.caption = values.romPower
      ? charged
        ? 'Захваченные электроны повышают порог: при чтении получается 0.'
        : 'У стёртой ячейки низкий порог: при чтении получается 1.'
      : `Питание отключено; сохранённый бит ${bit} остаётся в ячейке.`;
  } else if (node.type === 'floating-gate') {
    const bit = node.bit ?? 0;
    b = R(72, 37, 456, 37, 'metal outline', 3) + T(300, 56, 'УПРАВЛЯЮЩИЙ ЗАТВОР', 15);
    b += R(71, 102, 458, 146, 'gold fine', 3) + R(103, 139, 394, 68, 'metal-hi outline', 3);
    b += T(300, 121, 'ИЗОЛЯТОР', 14) + T(300, 228, 'ИЗОЛЯТОР', 14);
    if (bit === 0)
      b += repeat(11, (i) => C(128 + i * 34, 173, 9, 'paper fine') + T(128 + i * 34, 173, '−', 14));
    else b += T(300, 173, 'ПЛАВАЮЩИЙ ЗАТВОР', 16);
    b +=
      R(71, 276, 458, 39, 'board outline', 3) +
      T(300, 296, 'КРЕМНИЙ', 15) +
      T(300, 339, `Бит ${bit} · питание ${values.romPower ? 'вкл.' : 'выкл.'}`, 16);
    scene.control = control('romPower', 'Питание ROM: включено', 'Питание ROM: отключено');
    scene.caption =
      'Изолированный затвор удерживает записанное состояние после отключения питания.';
  }
  scene.body = b;
  return scene;
}
export { romSceneTypes, romScene };
