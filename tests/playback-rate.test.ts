import test from 'node:test';
import assert from 'node:assert/strict';
import { SilentMedia } from '../src/story/media.ts';

test('changing speed keeps the silent media position continuous through play, pause and resume', async (t) => {
  let elapsed = 0;
  t.mock.method(performance, 'now', () => elapsed);
  const media = new SilentMedia(20);
  await media.play();
  elapsed = 1000;
  assert.equal(media.currentTime, 1);
  media.playbackRate = 0.5;
  assert.equal(media.currentTime, 1);
  elapsed = 3000;
  assert.equal(media.currentTime, 2);
  media.pause();
  elapsed = 5000;
  media.playbackRate = 2;
  assert.equal(media.currentTime, 2);
  await media.play();
  elapsed = 6000;
  assert.equal(media.currentTime, 4);
  assert.throws(() => {
    media.playbackRate = 0;
  });
});
