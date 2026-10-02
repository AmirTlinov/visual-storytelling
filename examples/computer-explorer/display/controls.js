class DisplayControls {
  constructor(element, model, changed, save) {
    this.abort = new AbortController();
    this.element = element;
    this.model = model;
    this.step = element.querySelector('[data-display-step]');
    this.frame = element.querySelector('[data-display-frame]');
    this.light = element.querySelector('[data-display-light]');
    this.status = element.querySelector('[data-display-status]');
    this.editor = element.querySelector('[data-display-editor]');
    this.address = element.querySelector('[data-display-address]');
    this.channels = [...element.querySelectorAll('[data-display-channel]')].map((input) => ({
      input,
      output: input.parentElement.querySelector('output'),
      index: Number(input.dataset.displayChannel),
    }));
    element.addEventListener(
      'click',
      (event) => {
        const button = event.target.closest('button');
        if (!button) return;
        if (button === this.step) model.step();
        else if (button === this.frame) model.refresh();
        else if (button === this.light) model.backlight = !model.backlight;
        else return;
        changed();
        save();
      },
      { signal: this.abort.signal },
    );
    element.addEventListener(
      'input',
      (event) => {
        const channel = event.target.dataset.displayChannel;
        if (channel === undefined || !this.pixel) return;
        model.write(this.pixel.row, this.pixel.col, Number(channel), Number(event.target.value));
        changed();
      },
      { signal: this.abort.signal },
    );
    element.addEventListener('change', () => save(), { signal: this.abort.signal });
  }
  show(scene) {
    this.element.hidden = !scene.display;
    this.pixel = scene.display?.pixel;
    if (!scene.display) return;
    this.step.textContent = this.model.action;
    this.status.textContent = this.model.status;
    this.light.setAttribute('aria-pressed', String(this.model.backlight));
    this.light.textContent = `Подсветка: ${this.model.backlight ? 'вкл.' : 'выкл.'}`;
    this.editor.hidden = !this.pixel;
    if (this.pixel) {
      this.address.textContent = `${scene.display.memoryLabel} · пиксель (${this.pixel.col}, ${this.pixel.row})`;
      const rgb = this.model.rgb(this.pixel.row, this.pixel.col, 'vram');
      this.channels.forEach(({ input, output, index }) => {
        const value = String(rgb[index]);
        input.value = value;
        output.textContent = value;
      });
    }
  }
  dispose() {
    this.abort.abort();
  }
}
export { DisplayControls };
