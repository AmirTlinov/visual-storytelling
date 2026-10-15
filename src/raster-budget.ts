/** Raster resources vary by delivery; model, layout and vector lettering do not. */
const profiles = {
  preview: { maxPixels: 1920 * 1080 },
  final: { maxPixels: 4096 * 2048 },
} as const;

export function rasterResolution(
  width: number,
  height: number,
  density: number,
  maxTextureSize: number,
) {
  const selected = (globalThis as Record<symbol, unknown>)[
    Symbol.for('visual-storytelling.render-profile')
  ];
  const profile = selected === 'final' ? 'final' : 'preview';
  if (![width, height, density, maxTextureSize].every((n) => Number.isFinite(n) && n > 0))
    throw new Error('Raster dimensions, density and texture limit must be finite and positive.');
  const maxPixels = profiles[profile].maxPixels;
  const ratio = Math.min(
    density,
    Math.sqrt(maxPixels / width / height),
    maxTextureSize / width,
    maxTextureSize / height,
  );
  return {
    profile,
    maxPixels,
    ratio,
    width: Math.max(1, Math.floor(width * ratio)),
    height: Math.max(1, Math.floor(height * ratio)),
  };
}
