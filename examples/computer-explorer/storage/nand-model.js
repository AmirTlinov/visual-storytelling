class NandModel {
  // A small SLC block: four word lines, eight strings. One sparse mask per
  // physical block keeps independent drives and erase boundaries explicit.
  constructor() {
    this.blocks = {};
  }
  key(n) {
    return `${n.drive === 'nvme' ? 'n' : 's'}${n.chip || 0}${n.die || 0}${n.plane || 0}${n.block || 0}`;
  }
  mask(n) {
    return this.blocks[this.key(n)] === undefined
      ? 0xffffffff
      : parseInt(this.blocks[this.key(n)], 16);
  }
  bit(n) {
    return (this.mask(n) >>> ((n.row || 0) * 8 + (n.col || 0))) & 1;
  }
  byte(n) {
    return Array.from({ length: 8 }, (_, col) => this.bit({ ...n, col }) << col).reduce(
      (a, b) => a | b,
      0,
    );
  }
  programByte(n, value) {
    for (let col = 0; col < 8; col++) if (!(value & (1 << col))) this.program({ ...n, col });
  }
  program(n) {
    this.blocks[this.key(n)] = ((this.mask(n) & ~(1 << ((n.row || 0) * 8 + (n.col || 0)))) >>> 0)
      .toString(16)
      .padStart(8, '0');
  }
  erase(n) {
    delete this.blocks[this.key(n)];
  }
  snapshot() {
    return { version: 1, blocks: { ...this.blocks } };
  }
  restore(saved) {
    this.blocks = {};
    if (saved?.version !== 1 || !saved.blocks || typeof saved.blocks !== 'object') return;
    for (const [key, value] of Object.entries(saved.blocks))
      if (
        /^(s[0-3]|n[01])[01]{3}$/.test(key) &&
        typeof value === 'string' &&
        /^[0-9a-f]{8}$/.test(value) &&
        value !== 'ffffffff'
      )
        this.blocks[key] = value;
  }
}
export { NandModel };
