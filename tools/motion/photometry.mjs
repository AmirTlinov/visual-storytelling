import sharp from 'sharp';
import { brightnessSpectrum } from './spectrum.mjs';

const linear = Float64Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const encoded = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const unknownPixel = (x, y) => ((x + y) % 8 < 3 ? [132, 70, 164] : [234, 218, 245]);
const png = async (data, width, height) =>
  `data:image/png;base64,${(
    await sharp(data, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer()
  ).toString('base64')}`;

export function parseSlice(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error('--slice must be a comma-separated string');
  const [axis, position, thickness = '3', ...rest] = value.split(',');
  if (
    !['x', 'y'].includes(axis) ||
    rest.length ||
    !position?.trim() ||
    !Number.isInteger(Number(position)) ||
    Number(position) < 0 ||
    !Number.isInteger(Number(thickness)) ||
    Number(thickness) < 1
  )
    throw new Error(
      '--slice needs x,y-position,thickness or y,x-position,thickness in source pixels',
    );
  return { axis, position: Number(position), thickness: Number(thickness) };
}

// Shared by the kymograph and region map. Gaps stay visibly unknown, never interpolated.
function timeColumns(points, count) {
  const intervals = points
    .slice(1)
    .map((p, i) => p.time - points[i].time)
    .sort((a, b) => a - b);
  const tolerance = intervals[Math.floor((intervals.length - 1) / 2)] * 0.65;
  let current = 0;
  return Array.from({ length: count }, (_, x) => {
    const t = points[0].time + (x / (count - 1)) * (points.at(-1).time - points[0].time);
    while (
      current + 1 < points.length &&
      Math.abs(points[current + 1].time - t) < Math.abs(points[current].time - t)
    )
      current++;
    return Math.abs(points[current].time - t) <= tolerance + 1e-9 ? current : -1;
  });
}

/** Reuses the timeline decode; stores only bounded luminance planes for the final slice. */
export function photometryCollector({ crop, slice, source = {} } = {}) {
  const points = [],
    planes = [];
  let geometry,
    low,
    high,
    reference,
    sizeChanged = false;
  const matte = source.theme === 'dark' ? 0 : 1;
  return {
    add(data, width, height, time, original) {
      const roi = crop ?? { x: 0, y: 0, width: original.width, height: original.height };
      if (!geometry) {
        geometry = { width, height, roi };
        reference = Buffer.alloc(width * height * 3);
        low = new Float32Array(width * height).fill(Infinity);
        high = new Float32Array(width * height).fill(-Infinity);
        if (slice) {
          const origin = slice.axis === 'x' ? roi.y : roi.x;
          const length = slice.axis === 'x' ? roi.height : roi.width;
          if (
            slice.position < origin ||
            slice.position >= origin + length ||
            slice.thickness > length
          )
            throw new Error('--slice must lie inside the selected crop or image');
        }
      }
      if (
        width !== geometry.width ||
        height !== geometry.height ||
        roi.width !== geometry.roi.width ||
        roi.height !== geometry.roi.height
      )
        sizeChanged = true;
      const luma = new Float32Array(width * height);
      const regions = new Array(12).fill(0),
        counts = new Array(12).fill(0);
      let luminance = 0,
        red = 0,
        green = 0,
        blue = 0,
        alpha = 0;
      for (let p = 0; p < width * height; p++) {
        const a = data[4 * p + 3] / 255;
        const r = linear[data[4 * p]] * a + matte * (1 - a);
        const g = linear[data[4 * p + 1]] * a + matte * (1 - a);
        const b = linear[data[4 * p + 2]] * a + matte * (1 - a);
        if (!points.length) {
          reference[3 * p] = Math.round(encoded(r));
          reference[3 * p + 1] = Math.round(encoded(g));
          reference[3 * p + 2] = Math.round(encoded(b));
        }
        const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        luma[p] = y;
        if (!sizeChanged) {
          low[p] = Math.min(low[p], y);
          high[p] = Math.max(high[p], y);
        }
        red += r;
        green += g;
        blue += b;
        luminance += y;
        alpha += a;
        const region =
          Math.min(2, Math.floor((Math.floor(p / width) * 3) / height)) * 4 +
          Math.min(3, Math.floor(((p % width) * 4) / width));
        regions[region] += y * 100;
        counts[region]++;
      }
      const count = width * height;
      const rgb = [red, green, blue].map((c) => encoded(c / count));
      const maximum = Math.max(...rgb);
      points.push({
        time,
        luminance: (luminance / count) * 100,
        red: rgb[0],
        green: rgb[1],
        blue: rgb[2],
        saturation: maximum ? ((maximum - Math.min(...rgb)) / maximum) * 100 : 0,
        alpha: (alpha / count) * 100,
        regions: regions.map((v, i) => (counts[i] ? v / counts[i] : null)),
      });
      planes.push(luma);
    },
    async finish() {
      const { width, height, roi } = geometry;
      if (sizeChanged)
        return {
          status: 'skipped',
          reason: 'Размер изображения меняется: выберите общую фиксированную область через --crop.',
        };
      const rows = new Float64Array(height),
        columns = new Float64Array(width);
      for (let p = 0; p < low.length; p++) {
        const d = high[p] - low[p];
        rows[Math.floor(p / width)] += d;
        columns[p % width] += d;
      }
      const row = rows.indexOf(Math.max(...rows)),
        column = columns.indexOf(Math.max(...columns));
      const axis = slice?.axis ?? (rows[row] >= columns[column] ? 'x' : 'y');
      const across = axis === 'x' ? height : width,
        along = axis === 'x' ? width : height;
      const sourceAcross = axis === 'x' ? roi.height : roi.width;
      const origin = axis === 'x' ? roi.y : roi.x;
      const center = slice
        ? Math.min(across - 1, Math.floor(((slice.position - origin) / sourceAcross) * across))
        : axis === 'x'
          ? row
          : column;
      const thickness = slice
        ? Math.max(1, Math.round((slice.thickness / sourceAcross) * across))
        : Math.min(3, across);
      const start = Math.max(0, Math.min(across - thickness, center - Math.floor(thickness / 2)));
      const profiles = planes.map((plane) =>
        Array.from({ length: along }, (_, i) => {
          let sum = 0;
          for (let d = start; d < start + thickness; d++)
            sum += plane[axis === 'x' ? d * width + i : i * width + d];
          return sum / thickness;
        }),
      );
      const imageWidth = Math.min(720, Math.max(320, points.length));
      const indices = timeColumns(points, imageWidth);
      const gapColumns = indices.filter((index) => index < 0).length;
      const emptyRegions = points[0].regions.flatMap((value, index) =>
        value === null ? [index] : [],
      );
      const ranges = Object.fromEntries(
        ['luminance', 'red', 'green', 'blue', 'saturation', 'alpha'].map((key) => {
          const values = points.map((point) => point[key]);
          return [
            key,
            [
              values.reduce((min, v) => Math.min(min, v), Infinity),
              values.reduce((max, v) => Math.max(max, v), -Infinity),
            ],
          ];
        }),
      );
      const kymoPixels = Buffer.alloc(imageWidth * along * 3),
        gridPixels = Buffer.alloc(imageWidth * 12 * 3);
      let range = 0;
      for (const point of points)
        point.regions.forEach((value, r) => {
          if (value !== null) range = Math.max(range, Math.abs(value - points[0].regions[r]));
        });
      for (let x = 0; x < imageWidth; x++) {
        const index = indices[x];
        for (let y = 0; y < along; y++) {
          const value =
            index < 0
              ? unknownPixel(x, y)
              : new Array(3).fill(Math.round(encoded(profiles[index][y])));
          value.forEach((v, c) => {
            kymoPixels[(y * imageWidth + x) * 3 + c] = v;
          });
        }
        for (let r = 0; r < 12; r++) {
          const delta =
            index < 0
              ? null
              : points[index].regions[r] === null
                ? null
                : points[index].regions[r] - points[0].regions[r];
          const strength = Math.min(1, Math.abs(delta ?? 0) / (range || 1));
          const color =
            delta === null
              ? unknownPixel(x, r)
              : [248, 248, 243].map((v, c) =>
                  Math.round(v + ((delta < 0 ? [42, 99, 160] : [185, 66, 47])[c] - v) * strength),
                );
          color.forEach((v, c) => {
            gridPixels[(r * imageWidth + x) * 3 + c] = v;
          });
        }
      }
      const spectrum = brightnessSpectrum(points, { sparse: source.sparse });
      return {
        status: 'available',
        roi,
        raster: { width, height },
        background: matte ? 'white' : 'black',
        from: points[0].time,
        to: points.at(-1).time,
        points,
        ranges,
        reference: { time: points[0].time, image: await png(reference, width, height) },
        measurement:
          'Relative luminance Y in linear sRGB; alpha composited over the declared matte. RGB is the encoded mean linear color; saturation is HSV of that mean.',
        kymograph: {
          axis,
          position: origin + ((start + thickness / 2) / across) * sourceAcross,
          thickness: (thickness / across) * sourceAcross,
          automatic: !slice,
          from: axis === 'x' ? roi.x : roi.y,
          to: axis === 'x' ? roi.x + roi.width : roi.y + roi.height,
          gapColumns,
          image: await png(kymoPixels, imageWidth, along),
        },
        regions: {
          columns: 4,
          rows: 3,
          empty: emptyRegions,
          deltaRange: range,
          image: await png(gridPixels, imageWidth, 12),
        },
        spectrum,
      };
    },
  };
}
