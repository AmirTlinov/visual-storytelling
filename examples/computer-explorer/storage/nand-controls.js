class NandControls {
  constructor(element, model, changed, save) {
    this.abort = new AbortController();
    this.element = element;
    this.model = model;
    this.node = null;
    this.program = element.querySelector('[data-nand-program]');
    this.erase = element.querySelector('[data-nand-erase]');
    this.status = element.querySelector('[data-nand-status]');
    element.addEventListener(
      'click',
      (event) => {
        if (!this.node) return;
        const button = event.target.closest('button');
        if (button === this.program) model.program(this.node);
        else if (button === this.erase) model.erase(this.node);
        else return;
        changed();
        save();
        if (button.disabled)
          (button === this.program ? this.erase : this.program).focus({ preventScroll: true });
      },
      { signal: this.abort.signal },
    );
  }
  show(scene) {
    this.node = scene.nand?.node;
    this.element.hidden = !this.node;
    if (!this.node) return;
    const n = this.node,
      bit = this.model.bit(n);
    this.program.disabled = bit === 0;
    this.erase.disabled = this.model.mask(n) === 0xffffffff;
    this.status.textContent = `${n.drive === 'nvme' ? 'NVMe' : 'SATA'} · NAND ${n.chip + 1} · кристалл ${n.die} · plane ${n.plane} · блок ${n.block} · WL${n.row}, BL${n.col}: ${bit}`;
  }
  dispose() {
    this.abort.abort();
  }
}
export { NandControls };
