import type { ControlValue } from '../controls/fields.js';

/** Centimetres are model units: grid and drawings always share this coordinate system. */
export const paperSize = { width: 18, height: 12, cell: 0.5, pixelsPerCm: 80 } as const;
export interface PageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface PageFrame {
  time: number;
  progress: number;
  reduced: boolean;
  mode?: 'story' | 'explore';
  values?: Readonly<Record<string, ControlValue>>;
}
export interface BookPage {
  id: string;
  title: string;
  text: string;
  seconds: number;
  /** Narrative inputs. The same inputs remain editable in Explore. */
  valuesAt?(frame: PageFrame): Record<string, ControlValue>;
  /** Accessible description of the current model, including edits in Explore. */
  describe?(frame: PageFrame): string;
  draw(page: PaperPage, frame: PageFrame): void;
}
export type PaperPalette = Record<string, string>;
export class PaperPage {
  readonly canvas = document.createElement('canvas');
  readonly context: CanvasRenderingContext2D;
  readonly size = paperSize;
  readonly safe: PageBox = { x: 0.5, y: 0.5, width: 17, height: 11 };
  readonly marks: { id: string; box: PageBox }[] = [];
  private palette: PaperPalette = {};
  constructor() {
    this.canvas.width = paperSize.width * paperSize.pixelsPerCm;
    this.canvas.height = paperSize.height * paperSize.pixelsPerCm;
    this.context = this.canvas.getContext('2d')!;
  }
  reset(palette: PaperPalette) {
    this.palette = palette;
    const c = this.context,
      { width: w, height: h, pixelsPerCm: p, cell } = paperSize;
    c.reset();
    c.setTransform(p, 0, 0, p, 0, 0);
    c.strokeStyle = this.ink('grid-ink');
    c.lineWidth = 0.015;
    c.beginPath();
    for (let x = cell; x < w; x += cell) {
      c.moveTo(x, 0);
      c.lineTo(x, h);
    }
    for (let y = cell; y < h; y += cell) {
      c.moveTo(0, y);
      c.lineTo(w, y);
    }
    c.stroke();
    this.marks.length = 0;
  }
  /** Theme pigments stay legible on the host's transparent light or dark surface. */
  ink(name = 'ink', alpha = 1) {
    const color = this.palette[name];
    if (!color) throw new Error(`Unknown paper pigment: ${name}`);
    return alpha === 1 ? color : `color-mix(in srgb, ${color} ${alpha * 100}%, transparent)`;
  }
  /** Register bounds for a custom drawing made through context. */
  bounds(id: string, box: PageBox) {
    if (!Object.values(box).every(Number.isFinite) || box.width < 0 || box.height < 0)
      throw new Error(`Invalid paper bounds: ${id}`);
    const b = this.safe;
    if (
      box.x < b.x - 0.02 ||
      box.y < b.y - 0.02 ||
      box.x + box.width > b.x + b.width + 0.02 ||
      box.y + box.height > b.y + b.height + 0.02
    )
      throw new Error(`Paper content ${id} exceeds its ${b.width} × ${b.height} cm safe area`);
    this.marks.push({ id, box });
  }
  /** Four 5 mm cells form one square centimetre. */
  cell(column: number, row: number): [number, number] {
    return [column * paperSize.cell, row * paperSize.cell];
  }
  rect(id: string, box: PageBox, fill = this.ink('blue', 0.18), stroke = this.ink('blue')) {
    this.bounds(id, box);
    const c = this.context;
    c.fillStyle = fill;
    c.strokeStyle = stroke;
    c.lineWidth = 0.035;
    c.lineJoin = 'round';
    c.fillRect(box.x, box.y, box.width, box.height);
    c.strokeRect(box.x, box.y, box.width, box.height);
  }
  line(
    id: string,
    from: readonly [number, number],
    to: readonly [number, number],
    color = this.ink(),
    width = 0.035,
  ) {
    this.bounds(id, {
      x: Math.min(from[0], to[0]),
      y: Math.min(from[1], to[1]),
      width: Math.abs(to[0] - from[0]),
      height: Math.abs(to[1] - from[1]),
    });
    const c = this.context;
    c.beginPath();
    c.moveTo(...from);
    c.lineTo(...to);
    c.strokeStyle = color;
    c.lineWidth = width;
    c.lineCap = 'round';
    c.stroke();
  }
  text(
    id: string,
    text: string,
    x: number,
    y: number,
    options: { size?: number; color?: string; align?: CanvasTextAlign } = {},
  ) {
    const c = this.context,
      size = options.size ?? 0.42;
    c.font = `${size}px "SketchPencil", "SketchShantell", sans-serif`;
    c.textAlign = options.align ?? 'left';
    c.textBaseline = 'alphabetic';
    const width = c.measureText(text).width;
    this.bounds(id, {
      x: x - (options.align === 'center' ? width / 2 : options.align === 'right' ? width : 0),
      y: y - size,
      width,
      height: size * 1.2,
    });
    c.fillStyle = options.color ?? this.ink();
    c.fillText(text, x, y);
    c.textAlign = 'left';
  }
  /** Fit a live drawing into a measured rectangle; preserve its aspect ratio. */
  image(id: string, source: CanvasImageSource, box: PageBox) {
    this.bounds(id, box);
    const input = source as {
      width?: number;
      height?: number;
      naturalWidth?: number;
      naturalHeight?: number;
    };
    const w = input.naturalWidth ?? input.width ?? box.width,
      h = input.naturalHeight ?? input.height ?? box.height;
    const scale = Math.min(box.width / w, box.height / h);
    this.context.drawImage(
      source,
      box.x + (box.width - w * scale) / 2,
      box.y + (box.height - h * scale) / 2,
      w * scale,
      h * scale,
    );
  }
}
