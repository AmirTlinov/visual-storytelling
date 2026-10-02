import { SimulationPlayer } from '@visual-storytelling/core';
export class CpuClock {
  constructor(element, model, changed, save) {
    this.element = element;
    this.model = model;
    this.points = [];
    this.status = element.querySelector('[data-clock-status]');
    this.marker = element.querySelector('[data-clock-marker]');
    let from = 0;
    this.player = SimulationPlayer.mount(element.querySelector('[data-clock-player]'), {
      read: () => ({
        value: model.time / model.period,
        done: model.done,
        stamp: model.done ? `Такт ${model.cycles}` : `Такт ${model.cycles} → ${model.cycles + 1}`,
      }),
      prepare: () => {
        model.begin();
        from = model.time;
      },
      advance: (elapsed) => {
        const previous = model.time;
        model.advance(from + (elapsed / 6200) * model.period);
        this.render();
        return [1, ...this.points, model.period / 2, model.settled, model.period].some(
          (time) => time > previous && time <= model.time,
        );
      },
      step: () => model.step(this.points),
      render: () => {
        changed();
        this.render();
      },
      commit: save,
    });
    this.player.view.play.dataset.clockPlay = '';
    this.player.view.next.dataset.clockStep = '';
  }
  show(scene) {
    this.element.hidden = !scene.clock;
    this.points = scene.clock?.points || [];
    this.render();
    this.player.update();
  }
  render() {
    const m = this.model;
    if (this.status.textContent !== m.phase) this.status.textContent = m.phase;
    const position = String(9 + (152 * m.time) / m.period);
    this.marker.setAttribute('x1', position);
    this.marker.setAttribute('x2', position);
    this.element.dataset.time = String(m.time);
    this.element.dataset.cycles = String(m.cycles);
  }
  pause(persist = true) {
    this.player.pause(persist);
    this.render();
  }
  get playing() {
    return this.player.playing;
  }
  dispose() {
    this.player.dispose();
  }
}
