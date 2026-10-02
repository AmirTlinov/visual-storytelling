import { R, repeat, P, C, G } from '../drawing/symbols.js';
// Axial section: the two winding strips are opposite sides of one annular coil.
function speakerMotor({
  shift = 0,
  current = false,
  key = 'voice-coil',
  labels = false,
  T = () => '',
} = {}) {
  let body = R(468, 60, 30, 240, 'metal outline', 2) + R(240, 150, 228, 60, 'metal outline', 2);
  body += R(263, 70, 55, 59, 'metal outline', 2) + R(263, 231, 55, 59, 'metal outline', 2);
  body += R(318, 70, 150, 45, 'chip outline', 2) + R(318, 245, 150, 45, 'chip outline', 2);
  body += repeat(7, (i) =>
    P(`M ${326 + i * 20} 76 l 12 32 M ${326 + i * 20} 251 l 12 32`, 'engraving'),
  );
  let coil = P('M 145 145 H 367 M 145 215 H 367 M 145 145 Q 132 180 145 215', 'gold fine');
  coil += repeat(8, (i) => {
    const x = 255 + i * 10;
    let winding = C(x, 138, 4.3, 'gold fine') + C(x, 222, 4.3, 'gold fine');
    if (current)
      winding += P(`M ${x - 2} 136 l 4 4 M ${x - 2} 140 l 4 -4`, 'micro') + C(x, 222, 1.6, 'dot');
    return winding;
  });
  body += G(key, coil, `translate(${shift} 0)`);
  if (labels) {
    body +=
      T(385, 92, 'МАГНИТ', 14, 'etch') +
      T(383, 269, 'МАГНИТ', 14, 'etch') +
      T(383, 181, 'ПОЛЮС', 15);
    body += T(286, 102, 'S', 16) + T(286, 262, 'S', 16) + T(270, 181, 'N', 16);
    body += P('M 289 147 V 132 M 289 212 V 229', 'leader');
    body += T(118, 119, 'КАТУШКА', 14) + P(`M 124 128 H ${248 + shift}`, 'leader');
  }
  return body;
}
export { speakerMotor };
