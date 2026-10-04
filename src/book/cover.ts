import { bookSize } from './geometry.js';
export function coverTexture(topic: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 1440;
  canvas.height = 960;
  const c = canvas.getContext('2d')!,
    { width: w, height: h } = bookSize;
  c.scale(80, 80);
  const background = c.createLinearGradient(0, 0, w, h);
  background.addColorStop(0, '#243f43');
  background.addColorStop(0.45, '#173236');
  background.addColorStop(1, '#12262c');
  c.fillStyle = background;
  c.fillRect(0, 0, w, h);
  // Deterministic engraved leather grain; it is part of the cover, never animated noise.
  for (let i = 0; i < 4500; i++) {
    const x = ((i * 73) % 1439) / 80,
      y = ((i * 137) % 959) / 80;
    c.fillStyle = i % 3 ? '#c5c4a508' : '#00000016';
    c.fillRect(x, y, 0.024, 0.024);
  }
  const gold = c.createLinearGradient(0, 0, w, h);
  gold.addColorStop(0, '#9d7b45');
  gold.addColorStop(0.4, '#e1c38a');
  gold.addColorStop(0.75, '#b29357');
  gold.addColorStop(1, '#e9d3a0');
  c.strokeStyle = gold;
  c.fillStyle = gold;
  c.lineWidth = 0.035;
  for (const inset of [0.42, 0.53, 0.83]) c.strokeRect(inset, inset, w - 2 * inset, h - 2 * inset);
  for (const [x, y, sx, sy] of [
    [0.8, 0.8, 1, 1],
    [w - 0.8, 0.8, -1, 1],
    [0.8, h - 0.8, 1, -1],
    [w - 0.8, h - 0.8, -1, -1],
  ]) {
    c.save();
    c.translate(x!, y!);
    c.scale(sx!, sy!);
    c.beginPath();
    c.moveTo(0, 1.35);
    c.bezierCurveTo(0.8, 1.35, 1.2, 0.7, 1.35, 0);
    c.bezierCurveTo(0.85, 0.45, 0.5, 0.45, 0, 0);
    c.stroke();
    c.beginPath();
    c.arc(0.54, 0.54, 0.18, 0, Math.PI * 2);
    c.stroke();
    c.restore();
  }
  c.save();
  c.translate(w / 2, 3.15);
  c.lineWidth = 0.024;
  for (let i = 0; i < 8; i++) {
    c.rotate(Math.PI / 4);
    c.beginPath();
    c.moveTo(0, -0.18);
    c.bezierCurveTo(-0.46, -0.66, -0.16, -1.16, 0, -1.37);
    c.bezierCurveTo(0.18, -1.05, 0.46, -0.63, 0, -0.18);
    c.stroke();
  }
  for (const r of [0.18, 0.62, 1.03]) {
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.stroke();
  }
  c.restore();
  c.textAlign = 'center';
  c.font = '1.28px Georgia,serif';
  c.fillText('Tlinov', w / 2, 5.6);
  c.font = '.3px Georgia,serif';
  c.fillText('Т А Й Н А Я   К Н И Г А', w / 2, 6.35);
  c.beginPath();
  c.moveTo(5, 6.9);
  c.lineTo(13, 6.9);
  c.stroke();
  c.font = '.66px Georgia,serif';
  c.fillText(topic, w / 2, 8.15, 14.5);
  c.font = '.27px Georgia,serif';
  c.fillText('ИСТОРИИ · ОТКРЫТИЯ · ПОНЯТНЫЕ МЕХАНИЗМЫ', w / 2, 9.4);
  const spine = c.createLinearGradient(0, 0, 0.65, 0);
  spine.addColorStop(0, '#070f18b0');
  spine.addColorStop(0.5, '#a7baad28');
  spine.addColorStop(1, '#00000000');
  c.fillStyle = spine;
  c.fillRect(0, 0, 0.8, h);
  return canvas;
}
