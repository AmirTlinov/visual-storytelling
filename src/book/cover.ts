import { bookSize } from './geometry.js';

/** Cloth, a stitched binding and a handwritten label belong to the physical notebook. */
export function coverTexture(topic: string) {
  const canvas = document.createElement('canvas');
  const { width: w, height: h, pixelsPerUnit: unit } = bookSize;
  canvas.width = w * unit;
  canvas.height = h * unit;
  const c = canvas.getContext('2d')!;
  c.scale(unit, unit);
  c.fillStyle = '#385c63';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 7000; i++) {
    c.fillStyle = i % 3 ? '#edf1e70a' : '#102a3020';
    c.fillRect(((i * 73) % canvas.width) / unit, ((i * 137) % canvas.height) / unit, 0.025, 0.04);
  }
  c.fillStyle = '#203e46';
  c.fillRect(0, 0, 0.7, h);
  c.strokeStyle = '#9eaba18a';
  c.lineWidth = 0.016;
  c.setLineDash([0.06, 0.06]);
  c.beginPath();
  c.moveTo(0.57, 0.25);
  c.lineTo(0.57, h - 0.25);
  c.stroke();
  c.setLineDash([]);
  c.fillStyle = '#11292e22';
  c.beginPath();
  c.roundRect(1.9, 2.65, 6.5, 5.15, 0.08);
  c.fill();
  c.fillStyle = '#f0f0e9';
  c.beginPath();
  c.roundRect(1.85, 2.58, 6.5, 5.15, 0.08);
  c.fill();
  c.strokeStyle = '#749198';
  c.lineWidth = 0.015;
  c.strokeRect(2.04, 2.77, 6.12, 4.77);
  c.fillStyle = '#29434b';
  c.textAlign = 'center';
  c.font = '1.12px SketchShantell';
  c.fillText('Tlinov', 5.1, 4.15);
  c.lineWidth = 0.018;
  c.beginPath();
  c.moveTo(2.7, 4.55);
  c.quadraticCurveTo(5.2, 4.61, 7.5, 4.51);
  c.stroke();
  c.font = '.46px SketchShantell';
  const lines: string[] = [];
  for (const word of topic.trim().split(/\s+/)) {
    const last = lines.length - 1;
    if (last >= 0 && c.measureText(`${lines[last]} ${word}`).width <= 5.4)
      lines[last] += ` ${word}`;
    else lines.push(word);
  }
  const scale = Math.min(1, 2 / (lines.length * 0.66));
  c.font = `${0.46 * scale}px SketchShantell`;
  lines.forEach((line, i) => c.fillText(line, 5.1, 5.48 + i * 0.66 * scale, 5.4));
  c.fillStyle = '#bfcbc4';
  c.font = '.23px SketchShantell';
  c.fillText('ЗАПИСИ · ОПЫТЫ · ОТКРЫТИЯ', 5.15, 12.7);
  return canvas;
}
