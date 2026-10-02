import { repeat, pin, G, R, P, C } from '../drawing/symbols.js';
import { displayRaster } from '../display/scenes.js';
import { rectBox } from '../drawing/geometry.js';
function flashPackage({ T }) {
  let body = repeat(4, (i) => pin(96, 77 + i * 29, 29, 12) + pin(235, 77 + i * 29, 29, 12));
  body += G(
    'die',
    R(124, 62, 116, 134, 'shadow outline', 5) + R(120, 58, 120, 134, 'chip outline', 5),
  );
  body +=
    P('M 127 178 V 70 L 132 64 H 229 M 234 73 V 178', 'engraving') + C(135, 76, 4, 'metal-hi');
  body +=
    T(180, 119, 'ROM', 23, 'etch') +
    T(180, 146, 'SPI NOR', 11, 'etch') +
    P('M 156 168 H 205 M 162 173 H 197', 'engraving');
  return { body };
}
const keyboardRows = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
function keyboardArt({ T }) {
  let body =
    R(5, 10, 350, 169, 'shadow outline', 8) +
    R(3, 6, 350, 169, 'metal outline', 8) +
    R(13, 16, 330, 145, 'paper fine', 4);
  keyboardRows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const x = 22 + c * 29 + r * 5,
        y = 25 + r * 28;
      body +=
        G(
          `key-${row[c]}`,
          R(x, y, 24, 23, 'metal-hi fine', 3) + P(`M ${x + 4} ${y + 19} h 16`, 'edge'),
        ) + T(x + 12, y + 11, row[c], 11);
    }
  });
  body +=
    G('key-space', R(79, 139, 147, 16, 'metal-hi fine', 3)) +
    G(
      'controller',
      R(252, 119, 73, 36, 'board fine', 2) +
        R(273, 126, 31, 21, 'chip fine', 1) +
        repeat(4, (i) => pin(267, 128 + i * 4, 6, 2) + pin(304, 128 + i * 4, 6, 2)),
    );
  body += C(323, 25, 2.8, 'die-dark');
  return { body };
}
function mouseArt({ inside = false }) {
  let body = P(
    'M 80 12 C 35 12 20 48 20 93 V 145 C 20 227 140 227 140 145 V 93 C 140 48 125 12 80 12 Z',
    'paper outline',
  );
  body +=
    P('M 80 12 V 93 M 20 93 Q 80 109 140 93', 'line') +
    R(70, 35, 20, 44, 'metal outline', 8) +
    repeat(6, (i) => P(`M 74 ${40 + i * 6} h 12`, 'micro'));
  if (inside) {
    body += P('M 38 103 H 123 L 119 175 Q 80 213 42 175 Z', 'board fine');
    body += G(
      'controller',
      R(59, 113, 44, 32, 'chip outline', 2) +
        repeat(6, (i) => pin(54, 117 + i * 4, 5, 2) + pin(103, 117 + i * 4, 5, 2)),
    );
    body += G(
      'sensor',
      R(55, 160, 52, 33, 'chip outline', 2) +
        R(64, 166, 34, 21, 'die', 1) +
        C(81, 176, 8, 'metal-hi fine') +
        C(81, 176, 4, 'die-dark'),
    );
    body += P('M 78 145 V 160 M 62 145 V 153 H 45 V 116 M 95 145 V 151 H 119', 'trace');
    body +=
      G('left', R(35, 49, 23, 30, 'chip fine', 2) + R(39, 45, 15, 8, 'metal fine', 1)) +
      G('right', R(102, 49, 23, 30, 'chip fine', 2) + R(106, 45, 15, 8, 'metal fine', 1));
  }
  return { body };
}
function monitorArt({ display }) {
  let body =
    R(18, 20, 324, 172, 'metal outline', 7) + G('pixels', R(25, 27, 310, 153, 'chip fine', 3));
  body += displayRaster(display, rectBox(33, 35, 294, 135));
  body += C(180, 185, 2, 'die');
  body += P('M 168 192 H 192 L 198 218 H 221 L 232 228 H 128 L 139 218 H 162 Z', 'metal outline');
  return { body };
}
function speakerArt() {
  let body = '';
  for (const x of [31, 211]) {
    body +=
      R(x + 3, 28, 113, 178, 'shadow outline', 6) +
      R(x, 25, 113, 178, 'metal outline', 6) +
      R(x + 8, 33, 97, 162, 'chip fine', 3);
    const side = x === 31 ? 'left' : 'right';
    body += G(
      `tweeter-${side}`,
      C(x + 56, 70, 24, 'metal outline') +
        C(x + 56, 70, 16, 'chip fine') +
        C(x + 56, 70, 7, 'die-dark'),
    );
    body += G(
      side,
      C(x + 56, 144, 43, 'paper outline') +
        C(x + 56, 144, 36, 'metal outline') +
        C(x + 56, 144, 27, 'chip fine') +
        C(x + 56, 144, 13, 'metal-hi fine'),
    );
    body += C(x + 18, 185, 2.6, 'die');
  }
  return { body };
}
export { monitorArt, flashPackage, keyboardArt, mouseArt, speakerArt, keyboardRows };
