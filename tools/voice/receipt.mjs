import { createHash } from 'node:crypto';

export const voiceBytesDigest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Stable narration/configuration identity; object key order is not an input. */
export const voiceDigest = (value) =>
  createHash('sha256')
    .update(
      JSON.stringify(value, (_, item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? Object.fromEntries(
              Object.keys(item)
                .sort()
                .map((key) => [key, item[key]]),
            )
          : item,
      ),
    )
    .digest('hex');
