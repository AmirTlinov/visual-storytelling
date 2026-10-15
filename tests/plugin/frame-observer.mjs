import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';

function drawingDigest(data, box) {
  const png = PNG.sync.read(Buffer.from(data, 'base64'));
  const left = Math.round(box.x),
    top = Math.round(box.y);
  const right = Math.round(box.x + box.width),
    bottom = Math.round(box.y + box.height);
  if (left < 0 || top < 0 || right > png.width || bottom > png.height)
    throw Error('The observed drawing must fit the captured browser viewport');
  const hash = createHash('sha256');
  for (let y = top; y < bottom; y++)
    hash.update(png.data.subarray((y * png.width + left) * 4, (y * png.width + right) * 4));
  return hash.digest('hex');
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
    begin() {
      frames.length = 0;
      return Date.now();
    },
    async matchedDrawing(box, startedEpoch) {
      const reference = await connection.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      });
      const hash = drawingDigest(reference.data, box);
      await new Promise((resolve) => setTimeout(resolve, 30));
      const matches = frames.filter(
        (frame) =>
          frame.timestamp * 1000 >= startedEpoch && drawingDigest(frame.data, box) === hash,
      );
      if (!matches.length)
        throw Error('No swapped browser frame matched the verified model drawing');
      return {
        hash,
        pixelMs: Math.min(...matches.map((frame) => frame.timestamp)) * 1000 - startedEpoch,
        png: Buffer.from(reference.data, 'base64'),
      };
    },
    async close() {
      await connection.send('Page.stopScreencast');
      await connection.detach();
    },
  };
}
