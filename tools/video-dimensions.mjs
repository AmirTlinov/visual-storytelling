/** One 16:9 frame contract for authoring tools, queued delivery and the encoder. */
export function videoDimensions({ width, height } = {}) {
  if (
    (width !== undefined && (!Number.isInteger(width) || width < 320 || width > 3840)) ||
    (height !== undefined && (!Number.isInteger(height) || height < 180 || height > 2160))
  )
    throw new Error('Video dimensions must fit 320×180 through 3840×2160.');
  if (width !== undefined && height !== undefined && width * 9 !== height * 16)
    throw new Error('Video must be 16:9. Supply only width or height, or a matching pair.');
  // Both dimensions stay even for YUV420 while the ratio remains exact.
  const units = Math.max(
    10,
    Math.min(
      120,
      Math.round(width !== undefined ? width / 32 : height !== undefined ? height / 18 : 30),
    ),
  );
  return { width: units * 32, height: units * 18 };
}
