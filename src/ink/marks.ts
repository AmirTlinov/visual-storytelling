/* Stable pen contours and translucent felt-tip paint. Text lives outside the paint. */

const n = (value: number) => +value.toFixed(3);
function inkShape(points: readonly (readonly [number, number])[], seed = 0, bend = 0.9) {
  return (
    points
      .map(([x, y], index) => {
        const [a, b] = points[(index + 1) % points.length]!,
          length = Math.hypot(a - x, b - y) || 1;
        const offset = bend * Math.sin(seed * 1.7 + index * 2.3 + 0.8);
        return (
          (index ? '' : `M${n(x)},${n(y)}`) +
          ` Q${n((x + a) / 2 - ((b - y) * offset) / length)},${n((y + b) / 2 + ((a - x) * offset) / length)} ${n(a)},${n(b)}`
        );
      })
      .join('') + 'Z'
  );
}
function inkBox(x: number, y: number, width: number, height: number, seed = 0, bend = 1.1) {
  const r = Math.min(3, width * 0.07, height * 0.08),
    b = bend * Math.sin(seed * 1.7 + 0.8);
  return `M${n(x + r)} ${n(y)} Q${n(x + width * 0.46)} ${n(y - b)} ${n(x + width - r)} ${n(y)} Q${n(x + width)} ${n(y)} ${n(x + width)} ${n(y + r)} Q${n(x + width + b * 0.6)} ${n(y + height * 0.51)} ${n(x + width)} ${n(y + height - r)} Q${n(x + width)} ${n(y + height)} ${n(x + width - r)} ${n(y + height)} Q${n(x + width * 0.53)} ${n(y + height + b * 0.7)} ${n(x + r)} ${n(y + height)} Q${n(x)} ${n(y + height)} ${n(x)} ${n(y + height - r)} Q${n(x - b * 0.5)} ${n(y + height * 0.46)} ${n(x)} ${n(y + r)} Q${n(x)} ${n(y)} ${n(x + r)} ${n(y)}Z`;
}
function markerDefs(prefix: string) {
  return `<defs data-ink-defs="${prefix}"><linearGradient id="${prefix}-fade"><stop stop-opacity="0" stop-color="white"/><stop offset=".008" stop-opacity=".5" stop-color="white"/><stop offset=".019" stop-color="white"/><stop offset=".981" stop-color="white"/><stop offset=".992" stop-opacity=".55" stop-color="white"/><stop offset="1" stop-opacity="0" stop-color="white"/></linearGradient><mask id="${prefix}-ends" maskUnits="objectBoundingBox" maskContentUnits="objectBoundingBox" x="-.1" y="-.1" width="1.2" height="1.2"><rect x="0" y="-.1" width="1" height="1.2" fill="url(#${prefix}-fade)"/></mask><filter id="${prefix}-soft" x="-10%" y="-10%" width="120%" height="120%" primitiveUnits="objectBoundingBox" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation=".0015 .006"/></filter></defs>`;
}
function markerMarkup({
  x,
  y,
  width,
  height,
  color = 'var(--ve-wash)',
  seed = 0,
  prefix,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  seed?: number;
  prefix: string;
}) {
  const wave = 0.012 * Math.sin(seed * 2.1 + 0.7),
    edge = 0.008 * Math.cos(seed * 1.3 + 0.9);
  // Local unit coordinates let layout resize the mark without regenerating its texture.
  const body = `M.016 .05 Q.24 ${n(-wave)} .5 .025 T.983 ${n(0.04 + wave)} Q1 ${n(0.32 + edge)} .99 .54 T.98 .96 Q.73 ${n(1 + wave)} .51 .978 T.018 ${n(0.966 - wave)} Q${n(-edge)} .7 .01 .5 T.016 .05Z`;
  const pass = `M.017 .69 Q.31 ${n(0.67 + wave)} .61 .69 T.985 .7 L.983 .85 Q.69 .82 .37 .85 T.016 .84Z`;
  return `<g class="ve-marker" transform="translate(${x} ${y}) scale(${width} ${height})" fill="${color}" stroke="none" filter="url(#${prefix}-soft)" mask="url(#${prefix}-ends)"><path d="${body}"/><path d="${pass}" opacity=".045"/></g>`;
}
export const SketchInk = { inkShape, inkBox, markerDefs, markerMarkup };
