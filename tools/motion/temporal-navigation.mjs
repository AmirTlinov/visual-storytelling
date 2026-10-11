/** The graph selects the existing player's time; it never owns a playback clock. */
export function installTemporalNavigation(
  root,
  frames,
  changes,
  chart,
  timeAtPoint,
  transitionTime,
) {
  const element = root.querySelector('[data-temporal-chart]');
  let view,
    index = 0;
  function cursor() {
    if (!view) return;
    const time = frames[index].time;
    const span = view.range.to - view.range.from;
    const x = view.plot.x + (span ? (time - view.range.from) / span : 0) * view.plot.width;
    element
      .querySelector('[data-time-cursor]')
      ?.setAttribute('d', `M${x} ${view.plot.y}v${view.plot.height}`);
    element.setAttribute('aria-valuenow', String(time));
    element.setAttribute(
      'aria-valuetext',
      `${time.toFixed(3)} с, кадр ${index + 1} из ${frames.length}`,
    );
  }
  function draw() {
    const width = Math.max(80, Math.round(element.clientWidth || 640));
    view = chart(changes, {
      from: frames[0].time,
      to: frames.at(-1).time,
      width,
      height: 112,
      at: frames[index].time,
      frames,
    });
    element.innerHTML = view.svg;
    // The focusable graph owns the accessible name and value.
    element.firstElementChild.setAttribute('aria-hidden', 'true');
    cursor();
  }
  function seek(time) {
    root.dispatchEvent(new CustomEvent('motionseek', { detail: { time, focus: false } }));
  }
  function pointer(event) {
    if (!view) return;
    const box = element.getBoundingClientRect();
    const x = Math.max(
      view.plot.x,
      Math.min(
        view.plot.x + view.plot.width,
        ((event.clientX - box.left) * view.width) / box.width,
      ),
    );
    const tolerance = (3 * (view.range.to - view.range.from)) / view.plot.width;
    seek(
      transitionTime(
        changes,
        timeAtPoint(view, [x, view.plot.y + view.plot.height / 2]),
        tolerance,
      ),
    );
  }
  element.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    element.focus({ preventScroll: true });
    element.setPointerCapture(event.pointerId);
    pointer(event);
  });
  element.addEventListener('pointermove', (event) => {
    if (element.hasPointerCapture(event.pointerId)) pointer(event);
  });
  element.addEventListener('keydown', (event) => {
    const selected = {
      ArrowLeft: index - 1,
      ArrowRight: index + 1,
      Home: 0,
      End: frames.length - 1,
    }[event.key];
    if (selected === undefined) return;
    event.preventDefault();
    seek(frames[Math.max(0, Math.min(frames.length - 1, selected))].time);
  });
  root.addEventListener('motionframe', (event) => {
    index = event.detail.index;
    cursor();
  });
  new ResizeObserver(draw).observe(element);
  draw();
}
