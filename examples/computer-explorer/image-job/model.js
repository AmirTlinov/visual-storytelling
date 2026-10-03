
// A 32-byte window of an NVMe read, projected onto the small NAND geometry.
// Command ordering: https://spdk.io/doc/nvme_spec.html
// Shared storage: https://developer.apple.com/documentation/metal/mtlstoragemode/shared
// Teaching ISA: byte loads/stores, with a wider intermediate value in R0.
const imageProgram = [
  ['LOAD', 'R0, [R1]'],
  ['ADD', 'R0, 16'],
  ['MIN', 'R0, 255'],
  ['STORE', '[R1], R0'],
  ['INC', 'R1'],
  ['CMP', 'R1, 0x1020'],
  ['JLT', '0'],
];
class ImageJob {
  constructor(nand, display, architecture) {
    this.nand = nand;
    this.display = display;
    this.architecture = architecture;
    this.restore();
  }
  get unified() {
    return this.architecture() === 'unified';
  }
  get gpuInput() {
    return this.unified ? this.ram : this.upload;
  }
  get done() {
    return this.phase === 'done';
  }
  get stage() {
    return ['queued', 'read', 'dma', 'complete'].includes(this.phase)
      ? 'ssd'
      : this.phase === 'cpu'
        ? 'cpu'
        : ['upload', 'dispatch', 'gpu', 'fence'].includes(this.phase)
          ? 'gpu'
          : 'monitor';
  }
  physical(index) {
    // Eight small teaching blocks, four byte-wide word lines per block.
    const block = [3, 0, 6, 1, 4, 7, 2, 5][Math.floor(index / 4)];
    return {
      drive: 'nvme',
      chip: 1,
      die: block >> 2,
      plane: (block >> 1) & 1,
      block: block & 1,
      row: index % 4,
      col: 0,
    };
  }
  get source() {
    return Array.from({ length: 32 }, (_, i) => this.nand.byte(this.physical(i)));
  }
  buffer(location) {
    return location === 'ssd' ? this.source : location === 'gpu' ? this.gpuInput : this.ram;
  }
  address(location, index) {
    return (location === 'ssd' ? 0 : location === 'gpu' && !this.unified ? 0x2000 : 0x1000) + index;
  }
  bit(node) {
    const value = this.buffer(node.imageLocation)[node.imageByte];
    return value === null ? 0 : (value >> node.imageBit) & 1;
  }
  toggleBit(node) {
    const buffer = this.buffer(node.imageLocation),
      i = node.imageByte;
    if (buffer[i] !== null) buffer[i] ^= 1 << node.imageBit;
  }
  start() {
    if (!this.prepared) {
      const sample = [
        16, 32, 64, 96, 128, 160, 208, 240, 32, 80, 112, 160, 208, 224, 128, 64, 64, 128, 224, 255,
        255, 208, 96, 32, 32, 64, 96, 160, 208, 128, 64, 16,
      ];
      // Keep existing experiments in NAND. Only initialize an erased region.
      if (this.source.every((value) => value === 255))
        sample.forEach((value, i) => this.nand.programByte(this.physical(i), value));
      this.prepared = true;
    }
    this.active = true;
    this.restart();
  }
  restart() {
    this.phase = 'queued';
    this.controller = Array(32).fill(null);
    this.ram = Array(32).fill(null);
    this.upload = Array(32).fill(null);
    this.cpu = { pc: 0, ir: null, r0: 0, r1: 0x1000, less: true, phase: 'fetch', instructions: 0 };
    this.gpu = { group: 0, phase: 'load', loaded: [], colors: [], written: 0 };
    this.scanSteps = 0;
    this.copied = 0;
  }
  step() {
    if (!this.active || this.done) return;
    switch (this.phase) {
      case 'queued':
        this.phase = 'read';
        break;
      case 'read':
        this.controller = this.source;
        this.phase = 'dma';
        break;
      case 'dma':
        this.ram = [...this.controller];
        this.phase = 'complete';
        break;
      case 'complete':
        this.phase = 'cpu';
        break;
      case 'cpu':
        this.cpuStep();
        break;
      case 'upload':
        this.upload = [...this.ram];
        this.copied = 32;
        this.phase = 'dispatch';
        break;
      case 'dispatch':
        this.phase = 'gpu';
        break;
      case 'gpu':
        this.gpuStep();
        break;
      case 'fence':
        this.display.row = 0;
        this.display.phase = 'hold';
        this.scanSteps = 0;
        this.phase = 'scanout';
        break;
      case 'scanout':
        this.display.step();
        if (++this.scanSteps === 36) this.phase = 'done';
        break;
    }
  }
  cpuStep() {
    const c = this.cpu;
    if (c.phase === 'fetch') {
      c.ir = c.pc;
      c.phase = 'decode';
      return;
    }
    if (c.phase === 'decode') {
      c.phase = 'execute';
      return;
    }
    switch (c.ir) {
      case 0:
        c.r0 = this.ram[c.r1 - 0x1000];
        break;
      case 1:
        c.r0 += 16;
        break;
      case 2:
        c.r0 = Math.min(255, c.r0);
        break;
      case 3:
        this.ram[c.r1 - 0x1000] = c.r0;
        break;
      case 4:
        c.r1++;
        break;
      case 5:
        c.less = c.r1 < 0x1020;
        break;
    }
    c.instructions++;
    c.pc = c.ir === 6 && c.less ? 0 : c.pc + 1;
    c.phase = 'fetch';
    if (c.pc === imageProgram.length) this.phase = this.unified ? 'dispatch' : 'upload';
  }
  gpuStep() {
    const g = this.gpu,
      start = g.group * 8;
    if (g.phase === 'load') {
      g.loaded = this.gpuInput.slice(start, start + 8);
      g.phase = 'shade';
      return;
    }
    if (g.phase === 'shade') {
      g.colors = g.loaded.map((v) => [v, Math.floor((v * 3) / 4), 255 - v]);
      g.phase = 'store';
      return;
    }
    g.colors.forEach((rgb, lane) => {
      const i = start + lane,
        row = Math.floor(i / 8) * 3,
        col = (i % 8) * 3;
      for (let y = 0; y < 3; y++)
        for (let x = 0; x < 3; x++)
          rgb.forEach((v, c) => this.display.write(row + y, col + x, c, v));
    });
    g.written += 8;
    if (++g.group === 4) this.phase = 'fence';
    else {
      g.phase = 'load';
      g.loaded = [];
      g.colors = [];
    }
  }
  get status() {
    const c = this.cpu,
      g = this.gpu;
    switch (this.phase) {
      case 'queued':
        return 'CPU → SQ · READ поставлен в очередь NVMe; doorbell уведомляет контроллер.';
      case 'read':
        return 'SSD · FTL выбирает физические страницы NAND для окна 32 байта.';
      case 'dma':
        return `DMA → ${this.unified ? 'LPDDR' : 'RAM'} · ${this.controller.length} байта в буфере SSD; память ещё не обновлена.`;
      case 'complete':
        return 'CQ · чтение завершено; 32 байта доступны CPU по адресу 0x1000.';
      case 'cpu':
        return `CPU · ${{ fetch: 'выборка', decode: 'декодирование', execute: 'исполнение' }[c.phase]} · PC ${c.pc} · ${imageProgram[c.pc]?.join(' ') || 'готово'} · байт ${Math.min(31, c.r1 - 0x1000)}/31`;
      case 'upload':
        return 'Копирование · CPU завершил запись; 32 байта RAM → VRAM ещё не переданы.';
      case 'dispatch':
        return this.unified
          ? 'Запуск GPU · общий буфер 0x1000 готов после завершения CPU. Копирование не требуется.'
          : 'Запуск GPU · копирование 32 байт в VRAM завершено.';
      case 'gpu':
        return `GPU · группа ${g.group + 1}/4 · ${{ load: 'загрузка 8 значений', shade: 'вычисление RGB', store: 'запись 8 участков кадра' }[g.phase]} · записано ${g.written}/32`;
      case 'fence':
        return 'GPU завершил кадр · ожидание подтверждения перед развёрткой LCD.';
      case 'scanout':
        return `LCD · ${this.display.action} · ${Math.floor(this.scanSteps / 3)}/12 строк`;
      case 'done':
        return `Готово · 32 байта с SSD → 224 инструкции CPU → 32 потока GPU → 288 пикселей LCD. Копирование RAM → VRAM: ${this.copied} B.`;
    }
  }
  snapshot() {
    return {
      version: 1,
      active: this.active,
      prepared: this.prepared,
      phase: this.phase,
      controller: [...this.controller],
      ram: [...this.ram],
      upload: [...this.upload],
      cpu: { ...this.cpu },
      gpu: {
        ...this.gpu,
        loaded: [...this.gpu.loaded],
        colors: this.gpu.colors.map((rgb) => [...rgb]),
      },
      scanSteps: this.scanSteps,
      copied: this.copied,
    };
  }
  restore(saved) {
    this.active = false;
    this.prepared = false;
    this.restart();
    if (saved?.version !== 1) return;
    const byte = (v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 255);
    const buffer = (v) => Array.isArray(v) && v.length === 32 && v.every(byte);
    const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
    const c = saved.cpu,
      g = saved.gpu;
    if (
      ![
        'queued',
        'read',
        'dma',
        'complete',
        'cpu',
        'upload',
        'dispatch',
        'gpu',
        'fence',
        'scanout',
        'done',
      ].includes(saved.phase) ||
      ![saved.controller, saved.ram, saved.upload].every(buffer) ||
      !c ||
      !g
    )
      return;
    if (
      !int(c.pc, 0, 7) ||
      !(c.ir === null || int(c.ir, 0, 6)) ||
      !int(c.r0, 0, 271) ||
      !int(c.r1, 0x1000, 0x1020) ||
      !int(c.instructions, 0, 224) ||
      !['fetch', 'decode', 'execute'].includes(c.phase) ||
      typeof c.less !== 'boolean'
    )
      return;
    if (
      !int(g.group, 0, 4) ||
      !int(g.written, 0, 32) ||
      !['load', 'shade', 'store'].includes(g.phase) ||
      !Array.isArray(g.loaded) ||
      ![0, 8].includes(g.loaded.length) ||
      !g.loaded.every((v) => int(v, 0, 255)) ||
      !Array.isArray(g.colors) ||
      ![0, 8].includes(g.colors.length) ||
      !g.colors.every(
        (rgb) => Array.isArray(rgb) && rgb.length === 3 && rgb.every((v) => int(v, 0, 255)),
      )
    )
      return;
    if (!int(saved.scanSteps, 0, 36) || ![0, 32].includes(saved.copied)) return;
    if (!['queued', 'read'].includes(saved.phase) && saved.controller.some((v) => v === null))
      return;
    if (!['queued', 'read', 'dma'].includes(saved.phase) && saved.ram.some((v) => v === null))
      return;
    if (
      saved.phase === 'cpu' &&
      (c.pc > 6 || (c.pc <= 3 && c.r1 === 0x1020) || (c.phase !== 'fetch' && c.ir === null))
    )
      return;
    if (
      !this.unified &&
      ['dispatch', 'gpu', 'fence', 'scanout', 'done'].includes(saved.phase) &&
      saved.upload.some((v) => v === null)
    )
      return;
    if (
      saved.phase === 'gpu' &&
      (g.group > 3 ||
        (this.unified ? saved.ram : saved.upload).some((v) => v === null) ||
        (g.phase !== 'load' && g.loaded.length !== 8) ||
        (g.phase === 'store' && g.colors.length !== 8))
    )
      return;
    this.active = saved.active === true;
    this.prepared = saved.prepared === true;
    this.phase = saved.phase;
    this.controller = [...saved.controller];
    this.ram = [...saved.ram];
    this.upload = [...saved.upload];
    this.cpu = { ...c };
    this.gpu = { ...g, loaded: [...g.loaded], colors: g.colors.map((rgb) => [...rgb]) };
    this.scanSteps = saved.scanSteps;
    this.copied = saved.copied;
  }
}
export { imageProgram, ImageJob };
