import { R, P, G, C, repeat } from '../drawing/symbols.js';
import { sataConnector } from './art.js';

function hddArt({ T }) {
  let b =
    R(35, 39, 537, 374, 'shadow outline', 16) +
    P(
      'M 52 34 H 548 Q 567 34 567 54 V 389 Q 567 408 548 408 H 52 Q 31 408 31 387 V 56 Q 31 34 52 34 Z',
      'metal outline',
    );
  b +=
    P('M 65 51 H 539 V 389 H 55 V 69 Z', 'metal fine') +
    G(
      'interface',
      sataConnector(() => '', 0, 0),
      'translate(31 78) rotate(90)',
    );
  for (const [x, y] of [
    [48, 55],
    [550, 57],
    [48, 390],
    [550, 390],
    [336, 55],
    [336, 390],
  ])
    b +=
      C(x, y, 5, 'chip fine') + P(`M ${x - 2} ${y - 2} l 4 4 M ${x + 2} ${y - 2} l -4 4`, 'edge');
  let platter = C(229, 218, 155, 'metal-hi outline') + C(229, 218, 148, 'metal fine');
  platter +=
    '<g opacity=".28">' +
    P(
      'M 123 112 A 150 150 0 0 1 331 108 L 229 218 Z M 117 315 A 148 148 0 0 0 335 319 L 229 218 Z',
      'metal-hi',
    ) +
    '</g>';
  platter += repeat(20, (i) => C(229, 218, 48 + i * 5, 'storage-track'));
  platter += P('M 118 121 A 147 147 0 0 1 348 132 M 108 301 A 146 146 0 0 0 340 310', 'edge');
  b += G('platter', platter);
  b += G(
    'spindle',
    C(229, 218, 39, 'chip outline') +
      C(229, 218, 29, 'metal outline') +
      C(229, 218, 12, 'metal-hi fine') +
      repeat(6, (i) => {
        const a = (i * Math.PI) / 3;
        return C(229 + Math.cos(a) * 21, 218 + Math.sin(a) * 21, 3, 'chip fine');
      }),
  );
  b +=
    G(
      'arm',
      P('M 433 298 L 290 139 L 274 151 L 413 315 Z', 'metal outline') +
        P('M 404 294 L 312 173 L 326 179 L 419 282 Z', 'paper fine'),
    ) +
    G(
      'actuator',
      P('M 443 292 L 483 330 L 527 307 L 497 265 Z', 'gold outline') +
        repeat(5, (i) =>
          P(`M ${456 + i * 4} ${294 + i * 2} l 28 24 l 29 -16 l -22 -28 Z`, 'trace'),
        ) +
        C(430, 299, 25, 'metal-hi outline') +
        C(430, 299, 13, 'chip outline'),
    );
  b += G(
    'head',
    P('M 285 141 L 275 149 L 266 137 L 276 129 Z', 'chip outline') +
      P('M 276 129 l -9 -11', 'gold fine'),
  );
  b += G('electronics', R(412, 68, 124, 55, 'metal-hi outline', 4)) + T(474, 95, 'PCB ↓', 18);
  b += G(
    'filter',
    P('M 91 356 Q 128 384 180 383 L 175 365 Q 133 367 108 346 Z', 'paper fine') +
      repeat(6, (i) => P(`M ${110 + i * 11} ${357 + i * 2} l 9 7`, 'micro')),
  );
  return { body: b };
}
export { hddArt };
