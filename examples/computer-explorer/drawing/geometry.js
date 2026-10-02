import { G } from './symbols.js';
const rectBox = (x, y, w, h) => ({ x, y, w, h });
function placedArt(key, body, source, box) {
  const s = Math.min(box.w / source.w, box.h / source.h);
  const x = box.x + (box.w - source.w * s) / 2 - source.x * s,
    y = box.y + (box.h - source.h * s) / 2 - source.y * s;
  // The placed component owns its contour; nested artwork is detail.
  return G(key, body.replace(/ data-part="[^"]*"/g, ''), `translate(${x} ${y}) scale(${s})`);
}
const sceneBoxes = {
  'sata-ssd': rectBox(0, 22, 584, 386),
  'nvme-ssd': rectBox(8, 36, 580, 210),
  'm2-module': rectBox(12, 44, 570, 162),
  hdd: rectBox(0, 20, 590, 410),
  ram: rectBox(32, 68, 296, 123),
  cpu: rectBox(85, 25, 188, 192),
  'cpu-die': rectBox(119, 61, 124, 122),
  gpu: rectBox(0, 20, 360, 268),
  'gpu-package': rectBox(67, 12, 225, 214),
  'gpu-die': rectBox(102, 53, 155, 127),
  vram: rectBox(-4, -4, 104, 130),
  lpddr: rectBox(-4, -4, 104, 130),
  'sram-cell': rectBox(27, 18, 305, 207),
  gate: rectBox(40, 10, 520, 440),
  rom: rectBox(85, 43, 190, 162),
  keyboard: rectBox(0, 0, 360, 190),
  mouse: rectBox(0, 0, 160, 220),
  monitor: rectBox(10, 12, 340, 222),
  speakers: rectBox(22, 20, 326, 195),
  'display-pixels': rectBox(0, 0, 600, 428),
  'display-scanout': rectBox(0, 0, 600, 420),
  'display-framebuffer': rectBox(0, 0, 600, 410),
  'lcd-pixel': rectBox(0, 0, 600, 400),
  'lcd-tft': rectBox(0, 0, 600, 400),
  'lcd-channel': rectBox(0, 0, 600, 400),
  'lcd-storage': rectBox(0, 0, 600, 400),
  'lcd-optics': rectBox(0, 0, 600, 410),
};

export { rectBox, placedArt, sceneBoxes };
