import { C, repeat, G, P, R, passive, via } from '../drawing/symbols.js';
import { hddArt } from './hdd-art.js';
import { sataConnector, storageIC } from './art.js';
import { rectBox } from '../drawing/geometry.js';

const hddSceneTypes = new Set([
  'hdd',
  'hdd-platter',
  'hdd-track',
  'hdd-sector',
  'hdd-medium',
  'hdd-head',
  'hdd-reader',
  'hdd-writer',
  'hdd-actuator',
  'hdd-spindle',
  'hdd-electronics',
  'hdd-read-channel',
  'hdd-adc',
]);
function annularSegment(cx, cy, inner, outer, start, end) {
  const point = (r, a) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
  return `M ${point(outer, start)} A ${outer} ${outer} 0 ${end - start > Math.PI ? 1 : 0} 1 ${point(outer, end)} L ${point(inner, end)} A ${inner} ${inner} 0 ${end - start > Math.PI ? 1 : 0} 0 ${point(inner, start)} Z`;
}
function hddScene(node, values, { scene, T, H, ctx, tile, bus, arrow, control }) {
  const up = values.hddPolarity !== false;
  let b = '';
  if (node.type === 'hdd') {
    b = hddArt(ctx).body;
    H('platter', 'Магнитная пластина', 'hdd-platter', 74, 63, 310, 310);
    H('spindle', 'Шпиндельный двигатель', 'hdd-spindle', 190, 179, 78, 78);
    H('arm', 'Рычаг головок', 'hdd-actuator', 274, 139, 160, 177);
    H('actuator', 'Привод головок · VCM', 'hdd-actuator', 388, 259, 149, 86);
    H('head', 'Блок чтения и записи', 'hdd-head', 258, 120, 39, 41);
    H('electronics', 'Электроника на обратной стороне', 'hdd-electronics', 412, 68, 124, 55);
    H('interface', 'SATA · данные и питание', 'storage-interface', 3, 78, 28, 265, {
      drive: 'sata',
    });
    scene.caption =
      'HDD со снятой крышкой: магнитная пластина, шпиндель, рычаг с головкой и привод VCM. Воздушный поток поддерживает полёт слайдера над поверхностью. Электроника находится с обратной стороны.';
  } else if (node.type === 'hdd-platter') {
    b =
      C(240, 181, 153, 'metal outline') +
      repeat(24, (i) => C(240, 181, 53 + i * 3.9, 'storage-track')) +
      C(240, 181, 42, 'chip outline') +
      C(240, 181, 25, 'paper fine');
    const radii = [77, 110, 143];
    radii.forEach((r, i) => {
      const a = -1.14 + i * 0.68,
        key = `track-${i}`;
      b += G(key, P(annularSegment(240, 181, r - 5, r + 5, a, a + 0.43), 'die outline'));
      const x = 240 + r * Math.cos(a + 0.21),
        y = 181 + r * Math.sin(a + 0.21);
      H(key, `Дорожка ${i + 1}`, 'hdd-track', x - 20, y - 22, 40, 44, { track: i });
    });
    b +=
      P('M 304 80 H 421 M 350 146 H 421 M 370 216 H 421', 'leader') +
      T(433, 80, 'Дорожки', 18, '', 'start') +
      T(433, 146, 'Сервометки', 16, '', 'start') +
      T(433, 216, 'Данные', 16, '', 'start');
    b += repeat(12, (i) =>
      P(annularSegment(240, 181, 54, 149, (i * Math.PI) / 6, (i * Math.PI) / 6 + 0.017), 'gold'),
    );
    scene.caption =
      'Данные лежат на концентрических дорожках, разделённых на секторы. Встроенные сервометки помогают удерживать головку над дорожкой. Выделены три участка для перехода внутрь; число дорожек сокращено.';
  } else if (node.type === 'hdd-track') {
    b = T(300, 30, 'УЧАСТОК ДОРОЖКИ', 18);
    for (let i = 0; i < 4; i++) {
      const x = 47 + i * 136;
      b +=
        G(
          `sector-${i}`,
          R(x, 116, 114, 98, 'metal outline', 5) +
            R(x + 7, 124, 9, 82, 'gold', 1) +
            repeat(19, (k) => P(`M ${x + 23 + k * 4.3} 134 v 62`, 'micro')),
        ) + T(x + 57, 243, `Сектор ${i}`, 15);
      H(`sector-${i}`, `Сектор ${i}`, 'hdd-sector', x, 116, 114, 98, {
        track: node.track || 0,
        sector: i,
      });
    }
    b +=
      P('M 47 87 H 550', 'line') +
      arrow(550, 87) +
      T(300, 64, 'движение поверхности под головкой', 15);
    scene.caption =
      'Дорожка показана развёрнутой. В учебном секторе выделены служебная область и записанные данные. На реальном диске число секторов зависит от зоны; расположение сервометок показано упрощённо.';
  } else if (node.type === 'hdd-sector') {
    b =
      G('sync', tile(36, 107, 93, 114, 'SYNC', 'gold')) +
      G(
        'data',
        R(140, 107, 303, 114, 'metal outline', 3) +
          repeat(14, (i) => R(150 + i * 20, 120, 12, 88, i % 3 ? 'die' : 'die-dark', 1)),
      ) +
      G('ecc', tile(454, 107, 109, 114, 'ECC', 'gold'));
    b +=
      T(290, 250, 'Пользовательские данные', 17) +
      T(300, 51, 'ФИЗИЧЕСКИЙ СЕКТОР', 19) +
      P('M 40 294 H 560', 'line') +
      arrow(560, 294);
    H('data', 'Магнитный слой данных', 'hdd-medium', 140, 107, 303, 114);
    H('ecc', 'Проверки ECC', 'ssd-ecc', 454, 107, 109, 114, { medium: 'hdd' });
    scene.caption =
      'Сектор содержит синхронизацию, данные и избыточность ECC. Физический формат отличается от логических секторов ОС: встречаются 512e и 4Kn. Размеры областей на рисунке условные.';
  } else if (node.type === 'hdd-medium') {
    b = T(300, 24, 'ПЕРПЕНДИКУЛЯРНАЯ МАГНИТНАЯ ЗАПИСЬ', 17);
    b +=
      R(48, 204, 504, 20, 'soft fine', 1) +
      R(48, 224, 504, 41, 'metal fine', 1) +
      R(48, 265, 504, 40, 'paper fine', 1);
    b +=
      T(300, 285, 'Подложка', 16) +
      T(300, 245, 'Мягкий магнитный подслой', 15) +
      T(300, 324, 'Ориентация намагниченности · срез', 15);
    for (let group = 0; group < 6; group++) {
      const direction = (group % 2 === 0) === up ? 'up' : 'down',
        x = 48 + group * 84;
      b += G(
        `region-${group}`,
        R(x, 116, 84, 88, group % 2 ? 'die-dark fine' : 'die fine', 0) +
          repeat(5, (i) => P(`M ${x + 3 + i * 16} 117 l 3 26 l -4 25 l 6 34`, 'edge')),
      );
      b += bus(x + 42, 141, x + 42, 181) + arrow(x + 42, direction === 'up' ? 140 : 182, direction);
    }
    b += R(243, 62, 114, 29, 'chip outline', 3) + T(300, 77, 'Головка', 14, 'etch');
    scene.control = control(
      'hddPolarity',
      'Изменить направление записи',
      'Изменить направление записи',
    );
    scene.caption =
      'В PMR намагниченность ориентирована перпендикулярно поверхности. Один записанный участок содержит много зёрен. Канал записи кодирует пользовательские биты в последовательность переходов намагниченности.';
  } else if (node.type === 'hdd-head') {
    b =
      R(38, 299, 524, 23, 'die fine', 1) +
      R(38, 322, 524, 15, 'metal fine', 1) +
      T(300, 347, 'Магнитный слой движется →', 15);
    b +=
      G(
        'reader',
        R(109, 77, 107, 180, 'metal outline', 4) +
          R(152, 209, 21, 66, 'die outline', 1) +
          P('M 113 278 H 146 M 177 278 H 212', 'line'),
      ) + T(163, 45, 'ЧТЕНИЕ · TMR', 17);
    b +=
      G(
        'writer',
        P('M 348 79 H 493 V 266 H 452 V 123 H 389 V 277 H 348 Z', 'metal outline') +
          repeat(6, (i) => R(330, 137 + i * 16, 81, 8, 'gold fine', 3)),
      ) + T(426, 45, 'ЗАПИСЬ', 17);
    b +=
      P('M 369 277 C 369 312 474 312 474 266 M 363 277 C 363 322 483 322 483 266', 'trace') +
      T(485, 286, 'поле', 14);
    b += P('M 56 274 H 91 M 56 298 H 91 M 74 276 V 296', 'leader') + T(85, 248, 'Зазор', 14);
    H('reader', 'Туннельный магниторезистивный датчик', 'hdd-reader', 109, 77, 107, 200);
    H('writer', 'Записывающий электромагнит', 'hdd-writer', 328, 79, 165, 201);
    scene.caption =
      'Слайдер несёт отдельные узлы чтения и записи. Катушка и полюса создают поле записи; TMR-датчик считывает поле поверхности через изменение сопротивления. Зазор и слои сильно увеличены.';
  } else if (node.type === 'hdd-reader') {
    b = T(300, 29, 'TMR · ТУННЕЛЬНЫЙ МАГНИТОРЕЗИСТИВНЫЙ ДАТЧИК', 16);
    b +=
      R(57, 75, 283, 35, 'metal fine') +
      R(57, 111, 283, 55, 'die outline') +
      R(57, 167, 283, 15, 'paper fine') +
      R(57, 183, 283, 55, 'die-dark outline') +
      R(57, 239, 283, 37, 'metal fine');
    b +=
      T(361, 93, 'Контакт', 14, '', 'start') +
      T(361, 139, 'Свободный слой', 15, '', 'start') +
      T(361, 174, 'Барьер MgO', 15, '', 'start') +
      T(361, 211, 'Опорный слой', 15, '', 'start') +
      T(361, 257, 'Закрепляющий стек', 14, '', 'start');
    b +=
      bus(129, 138, 268, 138) +
      arrow(up ? 268 : 129, 138, up ? 'right' : 'left') +
      bus(129, 210, 268, 210) +
      arrow(268, 210);
    b += T(
      300,
      312,
      up ? 'Параллельно → меньшее сопротивление' : 'Антипараллельно → большее сопротивление',
      17,
    );
    scene.control = control(
      'hddPolarity',
      'Развернуть свободный слой',
      'Развернуть свободный слой',
    );
    scene.caption =
      'Поле диска поворачивает намагниченность свободного слоя. Туннелирование через MgO зависит от его ориентации относительно опорного слоя. Электроника преобразует изменение сопротивления в сигнал чтения.';
  } else if (node.type === 'hdd-writer') {
    b = P('M 119 52 H 473 V 258 H 423 V 106 H 185 V 277 H 119 Z', 'metal outline');
    b +=
      repeat(8, (i) => R(95, 113 + i * 16, 116, 8, 'gold fine', 3)) +
      T(278, 83, 'Магнитопровод', 17) +
      T(69, 177, 'I', 19);
    b += G('medium', R(57, 305, 486, 15, 'die fine', 1) + R(57, 321, 486, 20, 'metal fine', 1));
    b += P('M 150 275 C 150 328 450 333 450 258 M 159 275 C 159 320 441 323 441 258', 'trace');
    b +=
      arrow(151, 289, 'down') +
      arrow(447, 279, 'up') +
      T(266, 273, 'Поток замыкается через среду', 14);
    H('medium', 'Зёрна магнитного слоя', 'hdd-medium', 57, 305, 486, 36);
    scene.caption =
      'Ток в катушке создаёт магнитный поток. Узкий основной полюс меняет направление намагниченности; широкий обратный полюс и мягкий подслой замыкают поток. Здесь показана схема PMR без HAMR.';
  } else if (node.type === 'hdd-actuator') {
    b =
      C(179, 176, 103, 'metal fine') +
      repeat(16, (i) => C(179, 176, 42 + i * 3.7, 'storage-track'));
    b += G(
      'arm',
      P('M 172 93 L 365 238 L 343 257 L 161 107 Z', 'metal outline') +
        P('M 225 149 L 331 226 L 328 236 Z', 'paper fine'),
    );
    b += P('M 371 221 L 438 120 Q 505 149 526 215 L 386 265 Z', 'chip outline');
    b += repeat(8, (i) =>
      P(
        `M ${375 + i * 3} ${232 - i * 2} L ${442 + i * 3} ${145 + i * 3} Q ${477 + i * 2} ${165 + i * 3} ${503 - i * 2} ${210 + i * 2} Z`,
        'trace',
      ),
    );
    b +=
      C(360, 246, 32, 'metal-hi outline') +
      C(360, 246, 15, 'chip outline') +
      T(466, 108, 'Магнит', 17) +
      T(492, 258, 'Катушка', 16) +
      T(360, 296, 'Ось рычага', 15);
    b += G('head', R(155, 83, 21, 22, 'chip outline', 2));
    H('head', 'Головка на конце рычага', 'hdd-head', 144, 73, 42, 43);
    b += T(300, 336, 'Voice coil actuator · поворот рычага', 17);
    scene.caption =
      'Катушка находится в поле постоянных магнитов. Ток создаёт силу и поворачивает рычаг; сервосистема корректирует положение по меткам на пластине. Движение головки по радиусу выбирает дорожку.';
  } else if (node.type === 'hdd-spindle') {
    b =
      C(233, 179, 150, 'metal outline') +
      G('rotor', C(233, 179, 133, 'chip fine') + C(233, 179, 112, 'paper fine'));
    for (let i = 0; i < 8; i++)
      b += P(
        annularSegment(
          233,
          179,
          116,
          132,
          (i * Math.PI) / 4 + 0.045,
          ((i + 1) * Math.PI) / 4 - 0.045,
        ),
        i % 2 ? 'die' : 'die-dark',
      );
    for (let i = 0; i < 9; i++) {
      const a = (i * Math.PI * 2) / 9;
      b += G(
        `winding-${i}`,
        R(-15, -15, 62, 30, 'metal fine', 2) +
          repeat(6, (k) => R(2 + k * 6, -20, 3, 40, 'gold fine', 1)),
        `translate(${233 + 42 * Math.cos(a)} ${179 + 42 * Math.sin(a)}) rotate(${(a * 180) / Math.PI})`,
      );
    }
    b +=
      C(233, 179, 37, 'metal-hi outline') +
      C(233, 179, 18, 'chip fine') +
      C(233, 179, 9, 'paper fine');
    b +=
      T(429, 87, 'Ротор · магниты', 16, '', 'start') +
      T(429, 162, 'Статор · обмотки', 16, '', 'start') +
      T(429, 240, 'Вал и подшипник', 16, '', 'start');
    b += P('M 346 83 H 416 M 305 162 H 416 M 255 192 L 397 240 H 416', 'leader');
    scene.caption =
      'Бесщёточный двигатель вращает пластины. Драйвер последовательно питает обмотки статора; поле взаимодействует с магнитами ротора. Показан условный поперечный срез, а не конкретная схема обмотки HDD.';
  } else if (node.type === 'hdd-electronics') {
    b =
      R(38, 43, 524, 274, 'board outline', 7) +
      G(
        'interface',
        sataConnector(() => '', 0, 0),
        'translate(38 49) rotate(90)',
      );
    const parts = [
      ['controller', 'SoC', 'controller', 79, 96, 147, 118],
      ['dram', 'DRAM', 'dram', 79, 243, 147, 49],
      ['channel', 'READ CHANNEL', 'hdd-read-channel', 281, 96, 219, 82],
      ['motor', 'MOTOR / VCM', 'hdd-spindle', 303, 221, 197, 71],
    ];
    b += P(
      'M 38 89 H 64 V 137 H 79 M 226 151 H 281 M 152 214 V 243 M 226 187 H 266 V 256 H 303',
      'trace',
    );
    parts.forEach(([key, label, type, x, y, w, h]) => {
      b += storageIC(key, rectBox(x, y, w, h), label, T);
      H(key, label, type, x, y, w, h);
    });
    b +=
      repeat(8, (i) => passive(522, 67 + i * 28, 15, 6)) + repeat(8, (i) => via(52 + i * 69, 306));
    scene.caption =
      'Плата снизу HDD: SoC обрабатывает команды и канал чтения, DRAM буферизует данные, силовой драйвер управляет шпинделем и VCM. В современных HDD часть этих функций объединена внутри SoC.';
  } else if (node.type === 'hdd-read-channel') {
    const parts = [
      ['sensor', 'TMR', 'hdd-reader', 41, 65],
      ['adc', 'АЦП', 'hdd-adc', 231, 65],
      ['detector', 'ДЕТЕКТОР', 'controller', 421, 65],
      ['ecc', 'ECC', 'ssd-ecc', 421, 233],
      ['buffer', 'БУФЕР', 'dram', 231, 233],
    ];
    b =
      P('M 171 105 H 231 M 361 105 H 421 M 486 145 V 233 M 421 273 H 361', 'line') +
      arrow(225, 105) +
      arrow(415, 105) +
      arrow(486, 225, 'down') +
      arrow(367, 273, 'left');
    parts.forEach(([key, label, type, x, y]) => {
      b += G(key, tile(x, y, 130, 80, label, 'metal-hi'));
      H(key, label, type, x, y, 130, 80, { medium: 'hdd' });
    });
    b +=
      T(300, 25, 'КАНАЛ ЧТЕНИЯ', 18) +
      T(130, 177, 'Предусилитель →', 14) +
      T(322, 177, 'Эквализация →', 14);
    scene.caption =
      'Слабый сигнал головки усиливается и оцифровывается. Эквализация и детектор восстанавливают записанную последовательность, ECC исправляет ошибки. Предусилитель обычно расположен на гибком шлейфе блока головок.';
  } else if (node.type === 'hdd-adc') {
    b = T(300, 24, 'АНАЛОГОВЫЙ СИГНАЛ → ОТСЧЁТЫ', 18) + P('M 54 63 V 246 H 553', 'line');
    const sample = (x) => 153 - 68 * Math.sin(((x - 54) * Math.PI) / 210);
    b += P(
      repeat(121, (i) => `${i ? 'L' : 'M'} ${54 + i * 4.1} ${sample(54 + i * 4.1)}`),
      'active-path',
    );
    for (let i = 0; i < 8; i++) {
      const x = 78 + i * 64,
        y = sample(x),
        code = Math.max(0, Math.min(7, Math.floor(((246 - y) / 183) * 8)));
      b +=
        P(`M ${x} ${y} V 246`, 'leader') +
        C(x, y, 4, 'dot') +
        T(x, 276, code.toString(2).padStart(3, '0'), 17, 'mono');
    }
    b += T(300, 315, 'Время →', 16);
    scene.caption =
      'АЦП измеряет амплитуду сигнала в моменты выборки. Здесь для наглядности 3 бита на отсчёт. Эти числа ещё не пользовательские биты: дальше работают эквалайзер, детектор последовательности и ECC.';
  }
  scene.body = b;
  return scene;
}
export { hddSceneTypes, hddScene };
