/** Runs inside the review document; the embedded scene retains its own media clock. */
export function installReviewPlayer() {
  const dialog = document.querySelector('#playback');
  if (!dialog) return;
  const frame = dialog.querySelector('iframe');
  const status = dialog.querySelector('[role=status]');
  let ready,
    handle,
    request = 0,
    watching = 0;
  const stop = () => {
    request++;
    cancelAnimationFrame(watching);
    handle?.pause?.();
  };
  function load() {
    return (ready ??= new Promise((resolve, reject) => {
      frame.addEventListener(
        'load',
        async () => {
          try {
            const win = frame.contentWindow,
              doc = frame.contentDocument;
            await win.galleryReady;
            await doc.fonts.ready;
            handle = doc.querySelector('.ve-scene')?.scene;
            if (
              !['seek', 'play', 'pause'].every(
                (method) => typeof handle?.[method] === 'function',
              ) ||
              !Number.isFinite(handle.currentTime)
            )
              throw new Error(
                'root.scene должен предоставлять seek(), play(), pause() и currentTime.',
              );
            handle.pause();
            resolve(() => handle.play());
          } catch (error) {
            reject(error);
          }
        },
        { once: true },
      );
      frame.srcdoc = document.querySelector('#review-scene').content.textContent;
    }));
  }
  async function run(button) {
    stop();
    const token = request;
    const start = Number(button.dataset.start),
      end = Number(button.dataset.end);
    dialog.querySelector('h2').textContent = button.dataset.title;
    status.textContent = 'Загрузка сцены…';
    if (!dialog.open) dialog.showModal();
    try {
      const play = await load();
      if (request !== token) return;
      handle.setReduced?.(dialog.dataset.reduced === 'true');
      handle.seek(start);
      const stage = frame.contentDocument.querySelector(
        '.ve-stage,svg.canvas,svg.vs-canvas,canvas',
      );
      if (stage) {
        const bounds = stage.getBoundingClientRect(),
          win = frame.contentWindow;
        win.scrollTo(
          0,
          Math.max(0, win.scrollY + bounds.top - (frame.clientHeight - bounds.height) / 2),
        );
      }
      await play();
      if (request !== token) return;
      status.textContent = 'Сверьте слова, движение и результат; сцену можно поворачивать.';
      const watch = () => {
        if (request !== token) return;
        const time = handle.currentTime;
        if (time >= end) {
          stop();
          handle.seek(end);
          status.textContent = 'Переход завершён. Итог оставлен для сравнения.';
        } else watching = requestAnimationFrame(watch);
      };
      watch();
    } catch (error) {
      if (request === token) status.textContent = error.message;
    }
  }
  document
    .querySelectorAll('[data-play-cue]')
    .forEach((button) => button.addEventListener('click', () => void run(button)));
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', stop);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
  });
}
