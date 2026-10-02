import { R, G, P, C, repeat, pin } from '../drawing/symbols.js';
import { keyboardArt, keyboardRows, mouseArt, speakerArt } from './art.js';
import { speakerMotor } from './speaker-motor.js';
const ioSceneTypes = new Set([
  'keyboard',
  'key-switch',
  'mouse',
  'optical-sensor',
  'photodiode',
  'speakers',
  'speaker-driver',
  'voice-coil',
  'io-hub',
]);
function ioScene(node, values, { scene, T, H, ctx, bus, arrow, control }) {
  let b = '';
  if (node.type === 'keyboard') {
    b = keyboardArt(ctx).body;
    keyboardRows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++)
        H(
          `key-${row[c]}`,
          `Клавиша ${row[c]}`,
          'key-switch',
          22 + c * 29 + r * 5,
          25 + r * 28,
          24,
          23,
        );
    });
    H('controller', 'Контроллер клавиатуры', 'controller', 252, 119, 73, 36);
    H('key-space', 'Пробел', 'key-switch', 79, 139, 147, 16);
    scene.caption =
      'Клавиша замыкает контакт; контроллер считывает матрицу клавиш и передаёт код по USB.';
  } else if (node.type === 'key-switch') {
    const down = values.keyDown,
      offset = down ? 28 : 0;
    b = R(145, 113, 310, 177, 'metal outline', 6) + R(165, 132, 270, 143, 'paper fine', 2);
    b += G(
      'moving-key',
      R(184, 45, 233, 36, 'metal-hi outline', 5) + R(274, 81, 53, 85, 'metal outline', 2),
      `translate(0 ${offset})`,
    );
    const springStep = ((down ? 234 : 213) - (166 + offset)) / 6;
    b += P(
      `M 300 ${166 + offset} l -17 ${springStep} l 34 ${springStep} l -34 ${springStep} l 34 ${springStep} l -34 ${springStep} l 17 ${springStep}`,
      'line',
    );
    b += P(`M 78 269 H 206 V 224 L 344 ${down ? 239 : 208} M 522 269 H 384 V 239 H 344`);
    if (down) b += P('M 78 269 H 206 V 224 L 344 239 H 384 V 269 H 522', 'active-path');
    b += T(300, 328, down ? 'Контакт замкнут' : 'Контакт разомкнут', 17);
    scene.control = control('keyDown', 'Клавиша: нажата', 'Клавиша: отпущена');
    scene.caption =
      'Нажатие соединяет два контакта. Контроллер распознаёт изменение электрического состояния.';
  } else if (node.type === 'mouse') {
    b = mouseArt({ ...ctx, inside: true }).body;
    H('sensor', 'Оптический сенсор', 'optical-sensor', 55, 160, 52, 33);
    H('controller', 'Контроллер мыши', 'controller', 59, 113, 44, 32);
    H('left', 'Левая кнопка', 'key-switch', 34, 42, 27, 40);
    H('right', 'Правая кнопка', 'key-switch', 99, 42, 27, 40);
    scene.caption =
      'Сенсор считывает поверхность; обработка кадров даёт смещение, которое передаётся по USB.';
  } else if (node.type === 'optical-sensor') {
    b = R(72, 36, 456, 292, 'chip outline', 7) + R(98, 59, 307, 240, 'board fine', 3);
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 5; col++) {
        const x = 111 + col * 57,
          y = 73 + row * 54;
        b += G(
          `pixel-${row}-${col}`,
          R(x, y, 45, 41, (row + col) % 3 ? 'die fine' : 'metal-hi fine', 2) +
            C(x + 22, y + 20, 10, 'paper fine'),
        );
        H(`pixel-${row}-${col}`, `Фотодиод ${row}:${col}`, 'photodiode', x, y, 45, 41);
      }
    b +=
      G('processor', R(428, 67, 73, 227, 'metal-hi fine', 2)) +
      T(465, 151, 'ADC', 17) +
      T(465, 186, 'DSP', 17);
    H('processor', 'Обработка сигнала', 'controller', 428, 67, 73, 227);
    scene.caption = 'Матрица светочувствительных элементов считывает изображение поверхности.';
  } else if (node.type === 'photodiode') {
    b =
      R(106, 137, 186, 108, 'die outline', 2) +
      R(292, 137, 190, 108, 'board outline', 2) +
      R(279, 137, 25, 108, 'gold', 0);
    b +=
      T(197, 191, 'p', 22) +
      T(390, 191, 'n', 22) +
      bus(106, 191, 61, 191) +
      bus(482, 191, 536, 191);
    b += R(100, 152, 6, 78, 'metal-hi fine', 0.5) + R(482, 152, 6, 78, 'metal-hi fine', 0.5);
    b += repeat(4, (i) => T(266, 151 + i * 27, '−', 12) + T(316, 151 + i * 27, '+', 12));
    if (values.light)
      b += repeat(
        3,
        (i) =>
          P(`M ${217 + i * 49} 54 l 11 13 l -7 13 l 13 16`, 'active-path') +
          arrow(234 + i * 49, 96, 'down'),
      );
    if (values.light)
      b +=
        C(235, 218, 14, 'paper fine') +
        T(235, 218, '+', 12) +
        C(352, 164, 14, 'paper fine') +
        T(352, 164, '−', 12) +
        P('M 221 218 H 198 M 366 164 H 397', 'active-path') +
        arrow(198, 218, 'left') +
        arrow(397, 164);
    b += T(300, 319, values.light ? 'Свет создаёт фототок' : 'Освещение выключено', 17);
    scene.control = control('light', 'Освещение: включено', 'Освещение: выключено');
    scene.caption =
      'Свет создаёт подвижные носители заряда в полупроводнике; их движение формирует сигнал.';
  } else if (node.type === 'speakers') {
    b = speakerArt(ctx).body;
    H('left', 'Левый динамик', 'speaker-driver', 45, 99, 88, 88);
    H('right', 'Правый динамик', 'speaker-driver', 225, 99, 88, 88);
    H('tweeter-left', 'Высокочастотный динамик', 'speaker-driver', 57, 43, 59, 55);
    H('tweeter-right', 'Высокочастотный динамик', 'speaker-driver', 237, 43, 59, 55);
    scene.caption =
      'Динамики превращают электрический сигнал в движение диффузора и колебания воздуха.';
  } else if (node.type === 'speaker-driver') {
    b =
      R(79, 48, 14, 269, 'metal outline', 3) +
      P('M 93 55 L 242 100 L 385 124 M 93 310 L 242 265 L 385 241', 'metal outline');
    b += P('M 92 72 Q 107 42 124 72 L 310 160 M 92 292 Q 107 322 124 292 L 310 203', 'line');
    b += P('M 125 77 L 305 164 M 125 287 L 305 199', 'fine');
    b += P('M 304 160 Q 267 181 304 203', 'paper outline');
    b += P(
      'M 319 151 l 6 -9 l 6 9 l 6 -9 l 6 9 l 6 -9 H 383 M 319 213 l 6 9 l 6 -9 l 6 9 l 6 -9 l 6 9 H 383',
      'line fine',
    );
    b += G('motor', speakerMotor({ key: 'coil' }), 'translate(220 70) scale(.62)');
    b += T(167, 329, 'ДИФФУЗОР', 14) + P('M 167 310 V 274', 'leader');
    b +=
      T(456, 282, 'МАГНИТ', 14) + T(302, 65, 'КАТУШКА', 14) + P('M 302 81 H 398 V 149', 'leader');
    H('coil', 'Звуковая катушка', 'voice-coil', 299, 149, 149, 67);
    scene.caption =
      'Разрез динамика: подвес и шайба направляют диффузор; кольцевая катушка движется в магнитном зазоре.';
  } else if (node.type === 'voice-coil') {
    const shift = values.speakerOn ? -23 : 0;
    b = speakerMotor({ shift, current: values.speakerOn, labels: true, T });
    if (values.speakerOn)
      b += P('M 174 320 H 98', 'active-path') + arrow(98, 320, 'left') + T(252, 320, 'СИЛА', 14);
    scene.control = control('speakerOn', 'Ток в катушке: есть', 'Ток в катушке: нет');
    scene.caption = values.speakerOn
      ? 'Ток взаимодействует с магнитным полем и смещает катушку. Для звука ток меняется во времени.'
      : 'Катушка находится в исходном положении; ток не подан.';
  } else if (node.type === 'io-hub') {
    b =
      G(
        'logic',
        R(229, 82, 150, 195, 'chip outline', 6) +
          repeat(8, (i) => pin(216, 98 + i * 20, 13, 7) + pin(379, 98 + i * 20, 13, 7)),
      ) + T(304, 168, 'I/O', 25, 'etch');
    b +=
      G(
        'usb',
        R(58, 91, 105, 55, 'metal outline', 4) +
          R(69, 103, 83, 29, 'chip', 2) +
          R(80, 110, 61, 13, 'die', 1),
      ) + T(109, 174, 'USB', 17);
    b += P('M 163 118 H 216 M 392 118 H 443 V 106 H 496 M 392 218 H 462 V 276 H 517');
    b +=
      G('spi', R(496, 76, 55, 59, 'chip outline', 3)) +
      T(523, 158, 'SPI', 16) +
      C(518, 276, 20, 'metal outline') +
      C(518, 276, 11, 'chip');
    H('usb', 'Контроллер USB', 'controller', 55, 88, 110, 64);
    H('spi', 'Контроллер SPI', 'controller', 491, 71, 65, 69);
    H('logic', 'Логика I/O', 'controller', 229, 82, 150, 195);
    scene.caption =
      'Контроллеры связывают процессор с USB-устройствами, памятью прошивки и аудиотрактом.';
  }
  scene.body = b;
  return scene;
}
export { ioSceneTypes, ioScene };
