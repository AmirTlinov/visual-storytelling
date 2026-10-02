import { gate, G, R, P, repeat, C } from '../drawing/symbols.js';

function computeScene(node, viewport, values, art) {
  const { scene, T, H, tile, bus, arrow, array, wedge, mark, control, unified } = art;
  let b = '';
  const logic = (kind, x, y, key, s = 0.55, label = kind.toUpperCase()) => {
    H(key, label, 'gate', x + 21 * s, y - 57 * s, 147 * s, 114 * s, { op: kind.toUpperCase() });
    return G(key, mark(kind, x, y, s)) + T(x + 102 * s, y + 78 * s, label, 13);
  };
  const block = (key, label, type, x, y, w, h, params = {}) => {
    H(key, label, type, x, y, w, h, params);
    return G(key, tile(x, y, w, h, label));
  };
  if (node.type === 'core') {
    b = R(34, 22, 532, 309, 'board outline', 7) + R(46, 34, 508, 285, 'chip fine', 3);
    b += block('decode', 'Декодер', 'decoder', 68, 58, 151, 75);
    b += G('l1', array(68, 167, 151, 99, 4, 8)) + T(143, 289, 'L1', 16, 'etch');
    H('l1', 'Кэш L1', 'cache-level', 68, 167, 151, 99);
    b += G('alu', wedge(269, 63, 124, 109)) + T(330, 194, 'ВЫЧИСЛЕНИЯ', 12, 'etch');
    H('alu', 'ALU', 'alu-level', 269, 63, 124, 109);
    b += G('registers', array(426, 59, 99, 113, 5, 4)) + T(474, 193, 'REG', 13, 'etch');
    H('registers', 'Регистры', 'register-file', 426, 59, 99, 113);
    b += P('M 219 94 H 269 M 393 114 H 426 M 330 172 V 232 H 219 M 426 240 H 355', 'edge');
    b += block('l2', 'L2', 'cache-level', 388, 220, 137, 70);
    scene.caption = 'Ядро: декодирование команд, ALU, регистры и локальный кэш.';
  } else if (node.type === 'sm') {
    b = R(37, 23, 526, 308, 'board outline', 6) + R(48, 34, 504, 286, 'chip fine', 3);
    b +=
      G(
        'instruction-cache',
        R(65, 46, 466, 27, 'metal-hi fine', 2) +
          repeat(16, (i) => P(`M ${72 + i * 28} 49 v 20`, 'engraving')),
      ) + T(298, 59, 'КЭШ КОМАНД', 13);
    H('instruction-cache', 'Кэш команд', 'cache-level', 65, 46, 466, 27);
    for (let col = 0; col < 4; col++) {
      const x = 65 + col * 119;
      b += P(`M ${x + 54} 73 V 88 M ${x + 54} 121 V 140`, 'trace');
      b +=
        G(`scheduler-${col}`, R(x + 4, 88, 101, 33, 'metal outline', 2)) +
        T(x + 54, 104, unified ? 'SIMD' : 'WARP', 13);
      H(
        `scheduler-${col}`,
        `Планировщик ${unified ? 'SIMD-группы' : 'warp'} ${col}`,
        'controller',
        x + 4,
        88,
        101,
        33,
      );
      b += G(
        `group-${col}`,
        R(x, 140, 109, 105, 'die fine', 2) +
          repeat(4, (i) => wedge(x + 10 + (i % 2) * 49, 150 + Math.floor(i / 2) * 42, 39, 30, '')) +
          repeat(3, (i) => R(x + 12 + i * 30, 228, 25, 5, 'metal-hi', 0.5)),
      );
      H(`group-${col}`, `Группа ${col}`, 'execution-group', x, 140, 109, 105);
      b += P(`M ${x + 54} 245 V 259`, 'trace');
    }
    b += P('M 119 259 H 476 M 177 259 V 273 M 421 259 V 273', 'trace');
    b +=
      G('registers', R(65, 273, 225, 33, 'chip fine', 2) + array(128, 275, 160, 29, 2, 9)) +
      T(96, 290, 'REG', 13, 'etch');
    H('registers', 'Регистры', 'register-file', 65, 273, 225, 33);
    b +=
      G('shared', R(311, 273, 220, 33, 'chip fine', 2) + array(417, 275, 112, 29, 2, 6)) +
      T(365, 290, viewport.w < 520 ? 'SH/L1' : 'SHARED / L1', 13, 'etch');
    H('shared', 'Shared / L1', 'array', 311, 273, 220, 33, { memory: 'sram' });
    scene.caption = unified
      ? 'Планировщики выдают команды SIMD-группам. Регистры и локальная shared/L1 — память внутри кластера GPU; общая LPDDR находится снаружи SoC.'
      : 'Планировщики выбирают готовые warp и выдают команды группам исполнения. Регистры и shared/L1 находятся внутри SM.';
  } else if (node.type === 'execution-group') {
    b = R(40, 30, 520, 285, 'board outline', 5) + P('M 70 83 H 530 M 70 238 H 530', 'trace');
    for (let i = 0; i < 4; i++) {
      const x = 69 + i * 121;
      const alu =
        P(
          `M ${x} 105 L ${x + 25} 207 H ${x + 74} L ${x + 99} 105 H ${x + 65} L ${x + 49} 130 L ${x + 34} 105 Z`,
          'paper outline',
        ) + T(x + 49, 166, 'ALU', 17);
      b +=
        G(`lane-${i}`, alu) +
        T(x + 49, 61, `Lane ${i}`, 14) +
        bus(x + 18, 83, x + 18, 105) +
        bus(x + 81, 83, x + 81, 105) +
        bus(x + 49, 207, x + 49, 238);
      H(`lane-${i}`, `ALU ${i}`, 'alu-level', x, 105, 99, 102);
    }
    b += block('registers', 'РЕГИСТРЫ', 'register-file', 116, 258, 369, 36);
    scene.caption = 'Линии исполнения обрабатывают разные данные. Открой ALU одной линии.';
  } else if (node.type === 'alu-level') {
    b = P('M 37 45 H 524 L 565 77 V 287 L 524 317 H 37 V 223 L 72 181 L 37 139 Z', 'metal outline');
    const unit = (key, label, type, x, y, w, h, glyph) => {
      H(key, label, type, x, y, w, h);
      return (
        G(key, R(x, y, w, h, 'chip fine', 3) + glyph) + T(x + w / 2, y + h - 18, label, 15, 'etch')
      );
    };
    b += unit(
      'adder',
      'Сумматор',
      'adder',
      112,
      74,
      174,
      81,
      repeat(
        4,
        (i) =>
          R(125 + i * 37, 88, 26, 20, 'metal-hi fine', 2) +
          (i < 3 ? P(`M ${151 + i * 37} 98 h 11`, 'trace') : ''),
      ),
    );
    b += unit(
      'logic',
      'Логика',
      'logic-bank',
      321,
      74,
      173,
      81,
      mark('and', 342, 99, 0.2) + mark('xor', 409, 99, 0.2),
    );
    b += unit(
      'shift',
      'Выбор / сдвиг',
      'mux-level',
      112,
      211,
      201,
      68,
      P('M 137 225 H 169 V 240 H 260 M 137 239 H 160 V 226 H 260', 'trace') +
        P('M 266 221 L 285 226 V 240 L 266 245 Z', 'metal-hi fine'),
    );
    b += unit(
      'flags',
      'Флаги',
      'register-word',
      353,
      211,
      141,
      68,
      repeat(4, (i) => R(366 + i * 29, 223, 22, 19, 'metal-hi fine', 1)),
    );
    b += P(
      'M 82 179 H 518 M 199 155 V 179 M 407 155 V 179 M 213 179 V 211 M 424 179 V 211',
      'trace',
    );
    b += T(300, 29, 'АРИФМЕТИКА И ЛОГИКА', 14);
    scene.caption = 'ALU объединяет арифметику, логические операции и выбор результата.';
  } else if (node.type === 'adder') {
    for (let i = 0; i < 4; i++) {
      const x = 74 + i * 123;
      b +=
        G(`adder-${i}`, R(x, 105, 90, 124, 'paper outline', 4)) +
        T(x + 45, 167, `FA${i}`, 18) +
        bus(x + 25, 64, x + 25, 105) +
        bus(x + 65, 64, x + 65, 105) +
        T(x + 25, 45, `A${i}`, 13) +
        T(x + 65, 45, `B${i}`, 13) +
        bus(x + 45, 229, x + 45, 282) +
        T(x + 45, 304, `S${i}`, 13);
      H(`adder-${i}`, `Разряд ${i}`, 'full-adder', x, 105, 90, 124);
      if (i < 3) b += bus(x + 90, 167, x + 123, 167) + arrow(x + 119, 167);
    }
    b +=
      bus(29, 167, 74, 167) +
      bus(533, 167, 573, 167) +
      T(47, 143, 'Cin', 13) +
      T(555, 143, 'Cout', 13);
    scene.caption = 'Четыре полных сумматора: каждый разряд передаёт перенос следующему.';
  } else if (node.type === 'full-adder') {
    const s = 0.48,
      d = 24 * s,
      out = 206 * s;
    b = P(
      `M 44 ${68 - d} H 145 M 76 ${68 + d} H 145 M 44 ${68 - d} V ${243 - d} H 145 M 76 ${68 + d} V ${243 + d} H 145 M ${145 + out} 68 H 283 V ${68 - d} H 390 M 283 68 V ${186 - d} H 320 M 44 139 H 302 V ${68 + d} H 390 M 302 139 V ${186 + d} H 320 M ${145 + out} 243 H 430 V ${243 - d} H 454 M ${320 + out} 186 H 441 V ${243 + d} H 454 M ${390 + out} 68 H 557 M ${454 + out} 243 H 575`,
    );
    b +=
      C(44, 68 - d, 3, 'dot') +
      C(76, 68 + d, 3, 'dot') +
      C(283, 68, 3, 'dot') +
      C(302, 139, 3, 'dot');
    b +=
      logic('xor', 145, 68, 'xor-ab', s) +
      logic('xor', 390, 68, 'xor-sum', s) +
      logic('and', 145, 243, 'and-ab', s) +
      logic('and', 320, 186, 'and-cin', s) +
      logic('or', 454, 243, 'or-carry', s);
    b +=
      T(26, 68 - d, 'A', 14) +
      T(60, 107, 'B', 14) +
      T(26, 139, 'Cin', 13) +
      T(552, 42, 'S', 17) +
      T(552, 300, 'Cout', 14);
    scene.caption = 'Сумма: A XOR B XOR Cin. Перенос: AB OR ((A XOR B) AND Cin).';
  } else if (node.type === 'logic-bank') {
    ['and', 'or', 'xor', 'not'].forEach((kind, i) => {
      const x = 85 + (i % 2) * 290,
        y = 94 + Math.floor(i / 2) * 171;
      b += logic(kind, x, y, kind, 0.72) + T(x - 14, y, `${i < 2 ? 'A' : 'B'}`, 14);
    });
    scene.caption =
      'Открой логический элемент, чтобы увидеть его реализацию на более простых элементах.';
  } else if (node.type === 'mux-level') {
    b = P(
      'M 46 60 H 202 V 78 H 261 M 46 282 H 202 V 244 H 261 M 374.3 91.2 H 411 V 149.8 H 439 M 374.3 257.2 H 411 V 176.2 H 439 M 552.3 163 H 579 M 62 172 H 98 M 211.3 172 H 232 V 104.4 H 261 M 80 172 V 270.4 H 261',
    );
    b +=
      C(80, 172, 3, 'dot') +
      logic('not', 98, 172, 'not-s', 0.55, 'NOT') +
      logic('and', 261, 91.2, 'and-a', 0.55) +
      logic('and', 261, 257.2, 'and-b', 0.55) +
      logic('or', 439, 163, 'or', 0.55);
    b += T(37, 60, 'A', 15) + T(37, 282, 'B', 15) + T(43, 172, 'S', 15) + T(567, 139, 'Y', 15);
    scene.caption =
      'Мультиплексор 2:1: сигнал S выбирает A или B. Из таких узлов собирают сдвигатель.';
  } else if (node.type === 'row-buffer') {
    b = R(43, 72, 514, 212, 'board outline', 5);
    for (let i = 0; i < 8; i++) {
      const x = 61 + i * 62;
      let amp = P(
        `M ${x + 3} 106 V 257 M ${x + 49} 106 V 257 M ${x + 3} 154 H ${x + 11} M ${x + 49} 154 H ${x + 40} M ${x + 3} 218 H ${x + 9} M ${x + 49} 218 H ${x + 38}`,
        'memory-wire',
      );
      amp += P(
        `M ${x + 11} 138 L ${x + 32} 154 L ${x + 11} 170 Z M ${x + 38} 202 L ${x + 17} 218 L ${x + 38} 234 Z`,
        'paper fine',
      );
      amp +=
        C(x + 36, 154, 4, 'paper fine') +
        C(x + 13, 218, 4, 'paper fine') +
        C(x + 3, 154, 1.8, 'dot') +
        C(x + 49, 218, 1.8, 'dot');
      b += G(`sense-${i}`, amp) + T(x + 25, 54, `${i}`, 14);
      H(`sense-${i}`, `Усилитель ${i}`, 'sense-amplifier', x, 105, 52, 153);
    }
    scene.caption =
      'Буфер строки — ряд усилителей, которые распознают и удерживают считанные биты.';
  } else if (node.type === 'sense-amplifier') {
    b = P('M 127 45 V 248 H 285.5 M 127 108 H 160 M 314.5 108 H 477 V 248 H 440 M 477 45 V 108');
    b += logic('not', 160, 108, 'inverter-a', 0.75);
    b +=
      G(
        'inverter-b',
        gate({ T: () => '' }, 'not').body,
        'translate(440 248) rotate(180) scale(.75) translate(-77 -120)',
      ) + T(363, 305, 'NOT', 13);
    H('inverter-b', 'Инвертор', 'gate', 301, 207, 123, 82, { op: 'NOT' });
    b +=
      C(127, 108, 3, 'dot') + C(477, 108, 3, 'dot') + T(127, 25, 'BL', 15) + T(477, 25, '/BL', 15);
    scene.caption =
      'Защёлка с положительной обратной связью усиливает разность напряжений BL и /BL.';
  } else if (node.type === 'decoder' || node.type === 'controller') {
    const registerBlock = (key, label, type, y) => {
      H(key, label, type, 69, y, 160, 89);
      return (
        G(
          key,
          R(69, y, 160, 89, 'chip outline', 3) +
            repeat(4, (i) => R(83 + i * 35, y + 15, 25, 24, 'metal-hi fine', 1)),
        ) + T(149, y + 64, label, 15, 'etch')
      );
    };
    b =
      registerBlock('buffer', 'Буфер', 'register-file', 53) +
      registerBlock('address', 'Адрес', 'register-word', 217);
    b += P('M 229 97 H 283 V 181 H 337 M 229 261 H 283 V 181');
    b += G(
      'logic',
      P('M 337 128 L 357 110 H 516 L 544 132 V 228 L 516 250 H 357 L 337 232 Z', 'chip outline') +
        repeat(3, (i) => mark('and', 363, 144 + i * 35, 0.24)),
    );
    b += repeat(3, (i) =>
      P(`M 412.44 ${144 + i * 35} H ${464 + i * 18} V ${154 + i * 27} H 544`, 'trace'),
    );
    b += T(468, 231, 'DECODE', 14, 'etch');
    H('logic', 'Декодирование', 'logic-bank', 337, 110, 207, 140);
    b +=
      P('M 544 154 H 579 M 544 181 H 579 M 544 208 H 579') +
      arrow(579, 154) +
      arrow(579, 181) +
      arrow(579, 208);
    scene.caption =
      'Буфер хранит входные биты, комбинационная логика формирует управляющие сигналы.';
  } else if (node.type === 'gate') {
    const op = node.op || 'NOT';
    if (op === 'XOR') {
      b = P(
        'M 65 116.8 H 125 M 90 143.2 H 125 M 65 116.8 V 56.8 H 300 M 90 143.2 V 283.2 H 300 M 238.3 130 H 266 V 83.2 H 300 M 253 130 V 256.8 H 300 M 413.3 70 H 426 V 156.8 H 435 M 413.3 270 H 426 V 183.2 H 435 M 548.3 170 H 557',
      );
      b +=
        logic('nand', 125, 130, 'nand-ab') +
        logic('nand', 300, 70, 'nand-a') +
        logic('nand', 300, 270, 'nand-b') +
        logic('nand', 435, 170, 'nand-out');
      b +=
        C(253, 130, 3, 'dot') + T(52, 116.8, 'A', 14) + T(76, 163, 'B', 14) + T(544, 144, 'Y', 14);
      scene.caption = 'XOR можно собрать из четырёх NAND. Каждый NAND раскрывается до CMOS.';
    } else if (op === 'AND' || op === 'OR') {
      const isAnd = op === 'AND';
      b = logic(isAnd ? 'nand' : 'nor', 109, 160, 'first', 0.8);
      b +=
        bus(273.8, 160, 341, 160) +
        logic('not', 341, 160, 'invert', 0.8) +
        T(300, 259, `${isAnd ? 'NAND' : 'NOR'} → NOT`, 16);
      scene.caption = `${op}: сначала ${isAnd ? 'NAND' : 'NOR'}, затем инвертор.`;
    } else {
      const mos = (key, x, y, p, input, showInput = true) => {
        H(key, `${p ? 'pMOS' : 'nMOS'} · ${input}`, 'transistor', x + 10, y - 33, 63, 66, {
          polarity: p ? 'p' : 'n',
        });
        return (
          G(
            key,
            P(
              `M ${x + 32} ${y - 25} V ${y + 25} M ${x + 23} ${y - 21} V ${y + 21} M ${x + 32} ${y - 18} H ${x + 55} V ${y - 41} M ${x + 32} ${y + 18} H ${x + 55} V ${y + 41} M ${x - 13} ${y} H ${x + 16}`,
            ) + (p ? C(x + 18, y, 5, 'paper outline') : bus(x + 16, y, x + 23, y)),
          ) +
          (showInput ? T(x - 28, y, input, 15) : '') +
          T(x + 91, y, p ? 'pMOS' : 'nMOS', 12)
        );
      };
      if (op === 'NAND') {
        b = P(
          'M 185 45 H 405 M 185 45 V 74 M 405 45 V 74 M 185 156 V 185 H 405 V 156 M 305 185 V 209 M 305 291 V 314 M 305 396 V 423 M 305 185 H 498',
        );
        b +=
          mos('pa', 130, 115, true, 'A') +
          mos('pb', 350, 115, true, 'B') +
          mos('na', 250, 250, false, 'A') +
          mos('nb', 250, 355, false, 'B') +
          C(305, 185, 3, 'dot');
      } else if (op === 'NOR') {
        b = P(
          'M 305 45 V 49 M 305 131 V 149 M 305 231 V 250 H 498 M 195 250 H 415 M 195 250 V 284 M 415 250 V 284 M 195 366 V 410 H 415 V 366 M 305 410 V 423',
        );
        b +=
          mos('pa', 250, 90, true, 'A') +
          mos('pb', 250, 190, true, 'B') +
          mos('na', 140, 325, false, 'A') +
          mos('nb', 360, 325, false, 'B') +
          C(305, 250, 3, 'dot');
      } else {
        b = P(
          'M 305 45 V 74 M 305 156 V 239 M 305 321 V 423 M 305 195 H 498 M 160 115 H 237 M 160 280 H 237 M 160 115 V 280',
        );
        b +=
          mos('p', 250, 115, true, 'A', false) +
          mos('n', 250, 280, false, 'A', false) +
          T(139, 195, 'A', 15) +
          C(305, 195, 3, 'dot');
      }
      const outputY = op === 'NAND' ? 185 : op === 'NOR' ? 250 : 195;
      b += T(304, 27, 'VDD', 15) + T(304, 442, 'GND', 15) + T(513, outputY, 'Y', 16);
      scene.caption = `${op} в CMOS: сеть pMOS соединяет выход с VDD, сеть nMOS — с землёй. Выбери транзистор.`;
    }
  } else if (node.type === 'transistor') {
    const p = node.polarity === 'p',
      known = values.gate !== null,
      on = known && (p ? !values.gate : values.gate);
    b = R(58, 170, 484, 139, 'board outline', 4);
    b += P(
      'M 82 170 H 204 V 205 Q 204 228 182 228 H 104 Q 82 228 82 205 Z M 395 170 H 517 V 205 Q 517 228 495 228 H 417 Q 395 228 395 205 Z',
      'die fine',
    );
    b +=
      R(82, 160, 435, 10, 'gold fine', 1) +
      R(204, 128, 191, 26, 'metal-hi outline', 2) +
      R(204, 154, 191, 6, 'gold fine', 1);
    b += R(131, 113, 25, 58, 'metal fine', 1) + R(443, 113, 25, 58, 'metal fine', 1);
    b += P('M 143 113 V 96 H 90 M 455 113 V 96 H 513 M 300 83 V 128');
    b += T(118, 75, 'SOURCE', 13) + T(480, 75, 'DRAIN', 13) + T(300, 61, 'GATE', 14);
    b +=
      T(143, 200, p ? 'p+' : 'n+', 17) +
      T(456, 200, p ? 'p+' : 'n+', 17) +
      T(300, 282, p ? 'n-Si' : 'p-Si', 15);
    b += repeat(9, (i) => P(`M ${77 + i * 54} 296 l 8 -8`, 'micro'));
    b += G(
      'channel',
      R(204, 170, 191, 12, 'board', 0) +
        (on
          ? P('M 200 179 H 399', 'active-path') +
            repeat(9, (i) => C(211 + i * 22, 180, 3.2, 'charge'))
          : ''),
    );
    b +=
      T(300, 216, !known ? 'Ожидание сигнала' : on ? 'Канал открыт' : 'Канал закрыт', 15) +
      T(300, 327, `${p ? 'p' : 'n'}MOS · разрез`, 14);
    H('channel', 'Канал', 'channel', 206, 165, 186, 41, { polarity: node.polarity });
    scene.control = control('gate', 'Затвор: высокое напряжение', 'Затвор: низкое напряжение');
    scene.caption =
      'Затвор отделён от кремния изолятором. Его электрическое поле управляет каналом.';
  } else if (node.type === 'channel') {
    const p = node.polarity === 'p',
      known = values.gate !== null,
      on = known && (p ? !values.gate : values.gate);
    b =
      R(54, 50, 491, 54, 'metal outline', 3) +
      R(54, 116, 491, 37, 'gold fine', 1) +
      R(54, 165, 491, 154, 'board outline', 3);
    b +=
      T(300, 78, 'ЗАТВОР', 17) + T(300, 135, 'ОКСИД · ИЗОЛЯТОР', 14) + T(300, 289, 'КРЕМНИЙ', 16);
    b += repeat(8, (i) => P(`M ${80 + i * 62} 178 v 90`, 'micro'));
    if (on) {
      b +=
        R(55, 173, 489, 44, 'die', 1) +
        repeat(
          12,
          (i) => C(75 + i * 40, 195, 9, 'paper fine') + T(75 + i * 40, 195, p ? '+' : '−', 13),
        );
      b += T(300, 245, p ? 'Дырки у поверхности' : 'Электроны у поверхности', 14);
    } else if (known)
      b += repeat(
        4,
        (i) => C(129 + i * 110, 259, 8, 'paper fine') + T(129 + i * 110, 259, p ? '+' : '−', 13),
      );
    else b += T(300, 218, 'Ожидание сигнала', 16);
    scene.control = control('gate', 'Затвор: высокое напряжение', 'Затвор: низкое напряжение');
    scene.caption = on
      ? 'Поле затвора создаёт проводящий канал у поверхности кремния.'
      : 'Проводящий канал не сформирован. Переключи напряжение затвора.';
  }
  if (!b) throw new Error(`Unknown scene: ${node.type}`);
  scene.body = b;
  return scene;
}
export { computeScene };
