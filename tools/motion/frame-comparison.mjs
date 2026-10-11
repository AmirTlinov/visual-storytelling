import sharp from 'sharp';
import { decodeMotionRasters } from './rasters.mjs';

/** Clean adjacent states at the same scale; no recolouring or invented intermediate frame. */
export async function renderFrameComparison(
  frames,
  { at, crop, maxSize = 960, theme = 'light' } = {},
) {
  const geometry = await decodeMotionRasters(frames, { crop, maxSize });
  const gap = 12,
    header = 38;
  const cellWidth = Math.max(240, geometry.width);
  const width = cellWidth * frames.length + gap * (frames.length - 1);
  const height = geometry.height + header;
  const tiles = await Promise.all(
    geometry.rasters.map(async (data, i) => ({
      input: await sharp(Buffer.from(data), {
        raw: { width: geometry.width, height: geometry.height, channels: 4 },
      })
        .png()
        .toBuffer(),
      left: i * (cellWidth + gap) + Math.floor((cellWidth - geometry.width) / 2),
      top: header,
    })),
  );
  const labels = frames
    .map((frame, i) => {
      const role = frame.time === at ? 'Selected' : frame.time < at ? 'Previous' : 'Next';
      const selected = frame.time === at;
      return `<text x="${i * (cellWidth + gap) + 12}" y="25" font-weight="${selected ? 600 : 400}">${role} · ${frame.time.toFixed(6)} s</text>`;
    })
    .join('');
  const background = theme === 'dark' ? '#20262b' : '#f5f7f8';
  const ink = theme === 'dark' ? '#eef1f3' : '#27343e';
  const headings = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${header}"><g font-family="system-ui,sans-serif" font-size="16" fill="${ink}">${labels}</g></svg>`,
  );
  return sharp({ create: { width, height, channels: 4, background } })
    .composite([{ input: headings, left: 0, top: 0 }, ...tiles])
    .png()
    .toBuffer();
}

export function comparisonFrames(selection) {
  return selection.previous
    ? [selection.previous, selection.current]
    : [selection.current, selection.next].filter(Boolean);
}
