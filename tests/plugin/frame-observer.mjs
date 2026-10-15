import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';

function drawingDigest(data, box, exclude = []) {
  const png = PNG.sync.read(Buffer.from(data, 'base64'));
  const left = Math.round(box.x),
    top = Math.round(box.y);
  const right = Math.round(box.x + box.width),
    bottom = Math.round(box.y + box.height);
  if (left < 0 || top < 0 || right > png.width || bottom > png.height)
    throw Error('The observed drawing must fit the captured browser viewport');
  const hash = createHash('sha256');
  for (let y = top; y < bottom; y++) {
    let start = left;
    const spans = exclude
      .filter((r) => y + 0.5 >= r.y && y + 0.5 < r.y + r.height)
      .map((r) => [
        Math.max(left, Math.ceil(r.x - 0.5)),
        Math.min(right, Math.ceil(r.x + r.width - 0.5)),
      ])
      .filter(([a, b]) => b > a)
      .sort((a, b) => a[0] - b[0]);
    for (const [a, b] of [...spans, [right, right]]) {
      if (a > start)
        hash.update(png.data.subarray((y * png.width + start) * 4, (y * png.width + a) * 4));
      start = Math.max(start, b);
    }
  }
  return hash.digest('hex');
}

/** A control repaint or an occluded subject cannot establish a visible model response. */
export function matchDrawingFrames(
  reference,
  frames,
  box,
  startedEpoch,
  { baseline, exclude = [] } = {},
) {
  const hash = drawingDigest(reference, box, exclude);
  if (baseline && drawingDigest(baseline, box, exclude) === hash)
    return {
      observed: false,
      reason: 'No visible subject pixels changed',
      hash,
      pixelMs: null,
      png: Buffer.from(reference, 'base64'),
    };
  const matched = frames
    .filter(
      (frame) =>
        frame.timestamp * 1000 >= startedEpoch && drawingDigest(frame.data, box, exclude) === hash,
    )
    .sort((a, b) => a.timestamp - b.timestamp)[0];
  if (!matched) throw Error('No swapped browser frame matched the verified model drawing');
  return {
    observed: true,
    hash,
    pixelMs: matched.timestamp * 1000 - startedEpoch,
    png: Buffer.from(matched.data, 'base64'),
  };
}

/** Owned Chromium frames, not OS display timing. Verify model semantics before selecting a drawing. */
export async function observeBrowserFrames(page) {
  const connection = await page.context().newCDPSession(page),
    frames = [];
  connection.on('Page.screencastFrame', (event) => {
    frames.push({ data: event.data, timestamp: event.metadata.timestamp });
    if (frames.length > 90) frames.shift();
    void connection.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
  });
  const viewport = page.viewportSize();
  await connection.send('Page.startScreencast', {
    format: 'png',
    maxWidth: viewport.width,
    maxHeight: viewport.height,
    everyNthFrame: 1,
  });
  return {
    async capture() {
      return (
        await connection.send('Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: false,
        })
      ).data;
    },
    begin() {
      frames.length = 0;
      return Date.now();
    },
    async matchedDrawing(box, startedEpoch, options) {
      const reference = await connection.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      return matchDrawingFrames(reference.data, frames, box, startedEpoch, options);
    },
    async close() {
      await connection.send('Page.stopScreencast');
      await connection.detach();
    },
  };
}
