import { SimulationPlayer } from '@visual-storytelling/core';
export class ImageJobControls {
  constructor(element, controls, model, { changed, save, open, home, pauseOther }) {
    this.element = element;
    this.controls = controls;
    this.model = model;
    this.abort = new AbortController();
    this.toggle = element.querySelector('[data-job-toggle]');
    this.actions = element.querySelector('[data-job-actions]');
    this.flow = element.querySelector('[data-job-flow]');
    this.status = element.querySelector('[data-job-status]');
    let next = 0;
    this.player = SimulationPlayer.mount(controls, {
      read: () => ({ value: 0, done: model.done, stamp: '', canStep: !model.done }),
      prepare: () => {
        pauseOther();
        if (model.done) {
          model.restart();
          home();
        }
        next = 0;
      },
      advance: (elapsed) => {
        if (elapsed < next) return false;
        const phase = model.phase,
          count = phase === 'cpu' ? 12 : 1;
        for (let i = 0; i < count && !model.done && model.phase === phase; i++) model.step();
        if (model.phase !== phase) save();
        next = elapsed + (phase === 'cpu' || phase === 'scanout' ? 150 : 700);
        return true;
      },
      step: () => {
        pauseOther();
        model.step();
      },
      render: () => {
        changed();
        this.show();
      },
      commit: save,
    });
    this.player.view.play.dataset.jobPlay = '';
    this.player.view.next.dataset.jobStep = '';
    element.addEventListener(
      'click',
      (event) => {
        const button = event.target.closest('button');
        if (!button) return;
        if (button.dataset.jobOpen) {
          this.pause(false);
          open(button.dataset.jobOpen);
          return;
        }
        if (button === this.toggle) {
          this.pause(false);
          pauseOther();
          if (model.active) model.active = false;
          else if (model.prepared) model.active = true;
          else model.start();
          home();
        } else if (button.hasAttribute('data-job-restart')) {
          this.pause(false);
          pauseOther();
          model.restart();
          home();
        } else return;
        changed();
        this.show();
        save();
      },
      { signal: this.abort.signal },
    );
  }
  show() {
    const m = this.model;
    this.toggle.setAttribute('aria-expanded', String(m.active));
    this.toggle.textContent = m.active ? 'SSD → экран · скрыть' : 'SSD → экран';
    this.actions.hidden = !m.active;
    this.controls.hidden = !m.active;
    this.flow.hidden = !m.active;
    this.status.hidden = !m.active;
    this.player.update();
    this.element.dataset.phase = m.phase;
    if (this.status.textContent !== m.status) this.status.textContent = m.status;
    this.flow.querySelector('[data-job-open="ram"]').title = m.unified
      ? 'Общий буфер CPU / GPU в LPDDR'
      : 'Буфер CPU в RAM';
    for (const button of this.flow.querySelectorAll('button'))
      button.setAttribute('aria-pressed', String(button.dataset.jobOpen === m.stage));
  }
  pause(persist = true) {
    this.player.pause(persist);
    this.show();
  }
  play() {
    this.player.play();
  }
  dispose() {
    this.player.dispose();
    this.abort.abort();
  }
}
