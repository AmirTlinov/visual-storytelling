/** Shared by the PNG renderer and saved-report player. Times remain in source seconds. */
export function onionLayers(frames, { at, radius } = {}) {
  if (!frames.length) throw new Error('Onion skin needs at least one frame');
  const requestedTime = at ?? (frames[0].time + frames.at(-1).time) / 2;
  if (
    !Number.isFinite(requestedTime) ||
    (radius !== undefined && (!Number.isFinite(radius) || radius <= 0))
  )
    throw new Error('Onion time must be finite and radius positive');
  const nearest = (time) => {
    let lo = 0,
      hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (frames[mid].time < time) lo = mid + 1;
      else hi = mid;
    }
    return lo && time - frames[lo - 1].time <= frames[lo].time - time ? lo - 1 : lo;
  };
  const index = nearest(requestedTime),
    time = frames[index].time;
  if (radius === undefined) {
    const first = Math.max(0, index - 4),
      last = Math.min(frames.length - 1, index + 4);
    const gaps = [];
    for (let i = first + 1; i <= last; i++) gaps.push(frames[i].time - frames[i - 1].time);
    gaps.sort((a, b) => a - b);
    const step = gaps[Math.floor(gaps.length / 2)] ?? 1;
    radius = Math.max(time - frames[first].time, frames[last].time - time) + step;
  }
  // At most four observed states on either side, sampled by time, never interpolated.
  const indices = new Set([index]);
  for (const direction of [-1, 1])
    for (let i = 1; i <= 4; i++) indices.add(nearest(time + (direction * radius * i) / 5));
  const layers = [...indices]
    .map((i) => ({
      index: i,
      time: frames[i].time,
      offset: frames[i].time - time,
      opacity: 0.5 * Math.max(0, 1 - Math.abs(frames[i].time - time) / radius),
    }))
    .filter((layer) => layer.opacity > 0)
    .sort((a, b) => Math.abs(b.offset) - Math.abs(a.offset) || a.time - b.time);
  return { requestedTime, time, index, radius, layers };
}

/** Installs a view on the existing player's clock; no capture, retiming or second player. */
export function installOnionPlayer(root, frames, selectLayers, radius, stop) {
  const image = root.querySelector('img');
  const canvas = root.querySelector('[data-onion-canvas]');
  const toggle = root.querySelector('[data-onion]');
  const windowControl = root.querySelector('[data-onion-window]');
  const input = windowControl.querySelector('input');
  const status = root.querySelector('[data-onion-status]');
  input.value = Number(radius.toPrecision(6));
  let index = 0,
    enabled = false,
    revision = 0,
    pending = false,
    running = false;
  const cache = new Map();
  const load = (i) => {
    if (!cache.has(i)) {
      const img = new Image();
      img.src = frames[i].image;
      cache.set(
        i,
        img.decode().then(() => img),
      );
    }
    return cache.get(i);
  };
  async function render() {
    if (running) return;
    running = true;
    try {
      while (pending && enabled) {
        pending = false;
        const token = revision;
        const view = selectLayers(frames, { at: frames[index].time, radius });
        const keep = new Set(view.layers.map((layer) => layer.index));
        for (const i of cache.keys()) if (!keep.has(i)) cache.delete(i);
        try {
          const images = await Promise.all(view.layers.map((layer) => load(layer.index)));
          if (token !== revision || !enabled) continue;
          canvas.width = Math.max(...images.map((img) => img.naturalWidth));
          canvas.height = Math.max(...images.map((img) => img.naturalHeight));
          const ctx = canvas.getContext('2d');
          view.layers.forEach((layer, i) => {
            ctx.globalAlpha = layer.opacity;
            ctx.drawImage(images[i], 0, 0);
          });
          ctx.globalAlpha = 1;
          canvas.dataset.time = view.time;
          canvas.hidden = false;
          image.hidden = true;
          status.textContent =
            'Наложено кадров: ' +
            view.layers.length +
            ' · текущий ' +
            view.time.toFixed(3) +
            ' с: 50% · края окна: 0%';
        } catch {
          if (token !== revision || !enabled) continue;
          cache.clear();
          status.textContent =
            'Не удалось прочитать соседний кадр. Показан текущий; наложение можно включить снова.';
        }
      }
    } finally {
      running = false;
    }
  }
  function update() {
    revision++;
    // Never leave a previous moment's overlay visible while a new one is loading.
    canvas.hidden = true;
    image.hidden = false;
    status.textContent = enabled ? 'Загрузка соседних кадров…' : '';
    pending = enabled;
    if (enabled) void render();
  }
  root.addEventListener('motionframe', (event) => {
    index = event.detail.index;
    update();
  });
  toggle.onclick = () => {
    stop();
    enabled = !enabled;
    toggle.setAttribute('aria-pressed', String(enabled));
    windowControl.hidden = !enabled;
    status.hidden = !enabled;
    update();
    if (!enabled) cache.clear();
  };
  input.onchange = () => {
    if (!Number.isFinite(input.valueAsNumber) || input.valueAsNumber <= 0) {
      input.setCustomValidity('Укажите положительный интервал в секундах');
      input.reportValidity();
      return;
    }
    input.setCustomValidity('');
    radius = input.valueAsNumber;
    stop();
    update();
  };
}
