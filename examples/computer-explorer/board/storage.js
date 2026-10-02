import { rectBox, sceneBoxes, placedArt } from '../drawing/geometry.js';
import { nvmeSsdArt, sataSsdArt } from '../storage/art.js';
import { hddArt } from '../storage/hdd-art.js';
import { P, R, C } from '../drawing/symbols.js';

function boardStorage(narrow, { T, H, io }) {
  const devices = narrow
    ? [
        {
          key: 'nvme',
          type: 'nvme-ssd',
          label: 'NVMe · M.2',
          box: rectBox(70, 525, 356, 98),
          draw: nvmeSsdArt,
        },
        {
          key: 'ssd',
          type: 'sata-ssd',
          label: 'SSD · SATA',
          box: rectBox(34, 857, 194, 136),
          draw: sataSsdArt,
        },
        {
          key: 'hdd',
          type: 'hdd',
          label: 'HDD · SATA',
          box: rectBox(274, 850, 202, 148),
          draw: hddArt,
        },
      ]
    : [
        {
          key: 'nvme',
          type: 'nvme-ssd',
          label: 'NVMe · M.2',
          box: rectBox(279, 451, 368, 101),
          draw: nvmeSsdArt,
        },
        {
          key: 'ssd',
          type: 'sata-ssd',
          label: 'SSD · SATA',
          box: rectBox(216, 618, 184, 129),
          draw: sataSsdArt,
        },
        {
          key: 'hdd',
          type: 'hdd',
          label: 'HDD · SATA',
          box: rectBox(481, 610, 200, 147),
          draw: hddArt,
        },
      ];
  const source = (d) => sceneBoxes[d.key === 'nvme' ? 'm2-module' : d.type];
  const point = (d, x, y) => {
    const a = source(d),
      s = Math.min(d.box.w / a.w, d.box.h / a.h);
    return {
      x: d.box.x + (d.box.w - a.w * s) / 2 + (x - a.x) * s,
      y: d.box.y + (d.box.h - a.h * s) / 2 + (y - a.y) * s,
    };
  };
  const sata = point(devices[1], 12, 129),
    hdd = point(devices[2], 3, 118);
  let b = narrow
    ? P(
        `M 120 657 V 669 H 10 V 841 H ${sata.x} V ${sata.y} M 400 657 V 666 H 488 V 837 H ${hdd.x} V ${hdd.y}`,
        'cable',
      )
    : P(`M 311 582 V 602 H ${sata.x} V ${sata.y} M 590 582 V 597 H ${hdd.x} V ${hdd.y}`, 'cable');
  const ix = io.x + io.w / 2,
    iy = io.y + io.h;
  b += narrow
    ? P(
        `M ${ix} ${iy} V 508 H 57 V 567 H 70 M 120 645 V 630 H 57 V 508 M 400 645 V 632 H 434 V 508 H ${ix}`,
        'trace',
      )
    : P(
        `M ${ix} ${iy} V 438 H 264 V 501 H 279 M 311 570 V 555 H 240 V 438 H 264 M 590 570 V 562 H 668 V 438 H ${ix}`,
        'trace',
      );
  for (const d of devices) {
    if (d.key === 'nvme') {
      const screw = point(d, 575, 122);
      b +=
        R(d.box.x - 7, d.box.y + 3, 15, d.box.h - 6, 'chip outline', 2) +
        C(screw.x, screw.y, 7, 'gold fine') +
        C(screw.x, screw.y, 3, 'paper fine');
    }
    b += placedArt(d.key, d.draw({ T: () => '', inside: false }).body, source(d), d.box);
    b += T(d.box.x + d.box.w / 2, d.box.y + d.box.h + 18, d.label, 17, 'node-title');
    H(d.key, d.label, d.type, d.box.x - 3, d.box.y - 3, d.box.w + 6, d.box.h + 25, {
      drive: d.key === 'nvme' ? 'nvme' : 'sata',
    });
  }
  for (const x of narrow ? [120, 400] : [311, 590])
    b +=
      R(x - 12, narrow ? 645 : 570, 24, 15, 'chip outline', 2) +
      R(x - 8, narrow ? 650 : 575, 16, 4, 'gold', 1);
  return b;
}
export { boardStorage };
