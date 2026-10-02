class DisplayModel {
  // RGB888 sample-and-hold model: panel entries are calibrated intensity codes,
  // not simulated voltages. The row latch owns data already delivered to TCON.
  constructor() {
    this.width = 24;
    this.height = 12;
    this.restore();
  }
  seed() {
    const colors = [
      [255, 0, 0],
      [255, 255, 0],
      [0, 255, 0],
      [0, 255, 255],
      [0, 0, 255],
      [255, 0, 255],
    ];
    return Array.from({ length: this.height }, (_, row) =>
      Array.from({ length: this.width }, (_, col) => {
        const position = (col / (this.width - 1)) * (colors.length - 1),
          left = Math.min(Math.floor(position), colors.length - 2),
          mix = position - left;
        const brightness = 1 - (row / (this.height - 1)) * 0.9;
        return colors[left].map((value, c) =>
          Math.round((value + (colors[left + 1][c] - value) * mix) * brightness),
        );
      }).flat(),
    ).flat();
  }
  restore(saved = {}) {
    if (saved?.version !== 1) saved = {};
    const bytes = (value, length, fallback) =>
      Array.isArray(value) &&
      value.length === length &&
      value.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
        ? [...value]
        : [...fallback];
    const length = this.width * this.height * 3;
    this.vram = bytes(saved?.vram, length, this.seed());
    this.panel = bytes(saved?.panel, length, this.vram);
    this.row =
      Number.isInteger(saved?.row) && saved.row >= 0 && saved.row < this.height ? saved.row : 0;
    this.phase = ['hold', 'loaded', 'write'].includes(saved?.phase) ? saved.phase : 'hold';
    this.frames = Number.isSafeInteger(saved?.frames) && saved.frames >= 0 ? saved.frames : 0;
    this.latch = bytes(
      saved?.latch,
      this.stride,
      this.panel.slice(this.latchRow * this.stride, (this.latchRow + 1) * this.stride),
    );
    this.polarities =
      Array.isArray(saved?.polarities) &&
      saved.polarities.length === this.height &&
      saved.polarities.every((n) => n === 1 || n === -1)
        ? [...saved.polarities]
        : Array(this.height).fill(1);
    this.backlight = saved?.backlight !== false;
  }
  snapshot() {
    return {
      version: 1,
      vram: [...this.vram],
      panel: [...this.panel],
      latch: [...this.latch],
      polarities: [...this.polarities],
      row: this.row,
      phase: this.phase,
      frames: this.frames,
      backlight: this.backlight,
    };
  }
  address(row, col, channel = 0) {
    return (row * this.width + col) * 3 + channel;
  }
  get stride() {
    return this.width * 3;
  }
  get latchRow() {
    return this.phase === 'hold' ? (this.row + this.height - 1) % this.height : this.row;
  }
  rgb(row, col, source = 'panel') {
    const start = this.address(row, col);
    return this[source].slice(start, start + 3);
  }
  output(row, col) {
    return this.backlight ? this.rgb(row, col) : [0, 0, 0];
  }
  color(row, col, source = 'panel', channel) {
    const rgb = (source === 'panel' ? this.output(row, col) : this.rgb(row, col, source)).map(
      (value, i) => (channel !== undefined && channel !== i ? 0 : value),
    );
    return `rgb(${rgb.join(' ')})`;
  }
  write(row, col, channel, value) {
    this.vram[this.address(row, col, channel)] = Math.max(0, Math.min(255, Math.round(value)));
  }
  gateOpen(row) {
    return this.phase === 'write' && row === this.row;
  }
  step() {
    if (this.phase === 'hold') {
      this.latch = this.vram.slice(this.row * this.stride, (this.row + 1) * this.stride);
      this.phase = 'loaded';
    } else if (this.phase === 'loaded') {
      this.panel.splice(this.row * this.stride, this.stride, ...this.latch);
      this.polarities[this.row] = this.frames % 2 ? -1 : 1;
      this.phase = 'write';
    } else {
      this.phase = 'hold';
      this.row = (this.row + 1) % this.height;
      if (this.row === 0) this.frames++;
    }
  }
  refresh() {
    // Complete any in-flight line, then transfer one complete fresh frame.
    while (this.phase !== 'hold') this.step();
    for (let i = 0; i < this.height * 3; i++) this.step();
  }
  get action() {
    return this.phase === 'hold'
      ? `Прочитать строку ${this.row}`
      : this.phase === 'loaded'
        ? `Записать строку ${this.row}`
        : `Закрыть TFT строки ${this.row}`;
  }
  get status() {
    return this.phase === 'hold'
      ? `TFT закрыты · ячейки удерживают изображение`
      : this.phase === 'loaded'
        ? `Строка ${this.row}: ${this.stride} байта в буфере TCON · TFT ещё закрыты`
        : `Строка ${this.row}: TFT открыты · напряжения записаны в ячейки`;
  }
}
export { DisplayModel };
