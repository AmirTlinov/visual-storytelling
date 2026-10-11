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
  for (const direction of [-1, 1]) {
    const boundary = direction < 0 ? frames[0].time : frames.at(-1).time;
    const extent = Math.min(radius * 0.8, Math.abs(boundary - time));
    const adjacent = [];
    for (
      let i = index + direction;
      i >= 0 && i < frames.length && adjacent.length < 5;
      i += direction
    ) {
      if (Math.abs(frames[i].time - time) >= radius) break;
      adjacent.push(i);
    }
    if (adjacent.length <= 4) adjacent.forEach((i) => indices.add(i));
    else {
      indices.add(adjacent[0]);
      for (let i = 1; i <= 3; i++) indices.add(nearest(time + (direction * extent * i) / 3));
    }
  }
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

/** The same straight-alpha pixel composition is used by Node and the report canvas. */
export function composeOnion(rasters, width, height, layers) {
  const output = new Uint8ClampedArray(width * height * 4);
  const present = rasters[layers.findIndex((layer) => layer.offset === 0)];
  const tints = layers.map((layer) =>
    layer.offset < 0 ? [47, 107, 173] : layer.offset > 0 ? [186, 69, 67] : null,
  );
  for (let p = 0; p < output.length; p += 4) {
    let r = 0,
      g = 0,
      b = 0,
      a = 0;
    for (let i = 0; i < layers.length; i++) {
      const data = rasters[i],
        tint = tints[i];
      const alpha = (data[p + 3] / 255) * layers[i].opacity;
      if (!alpha) continue;
      const retained = 1 - alpha;
      // Unchanged context keeps its own colours; only temporal differences are tinted.
      const changed =
        tint &&
        (Math.abs(data[p] - present[p]) > 8 ||
          Math.abs(data[p + 1] - present[p + 1]) > 8 ||
          Math.abs(data[p + 2] - present[p + 2]) > 8 ||
          Math.abs(data[p + 3] - present[p + 3]) > 8);
      // Paint unchanged context once, with the present. Repeated opaque backgrounds erase trails.
      if (tint && !changed) continue;
      r = (changed ? data[p] * 0.2 + tint[0] * 0.8 : data[p]) * alpha + r * retained;
      g = (changed ? data[p + 1] * 0.2 + tint[1] * 0.8 : data[p + 1]) * alpha + g * retained;
      b = (changed ? data[p + 2] * 0.2 + tint[2] * 0.8 : data[p + 2]) * alpha + b * retained;
      a = alpha + a * retained;
    }
    if (a) {
      output[p] = r / a;
      output[p + 1] = g / a;
      output[p + 2] = b / a;
      output[p + 3] = a * 255;
    }
  }
  return output;
}

/** Installs a view on the existing player's clock; no capture, retiming or second player. */
export function installOnionPlayer(root, frames, selectLayers, compose, geometry, stop) {
  const image = root.querySelector('img');
  const canvas = root.querySelector('[data-onion-canvas]');
  const toggle = root.querySelector('[data-onion]');
  const windowControl = root.querySelector('[data-onion-window]');
  const input = windowControl.querySelector('input');
  const status = root.querySelector('[data-onion-status]');
  let radius = geometry.radius;
  input.value = Number(radius.toPrecision(3));
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
        img.decode().then(() => {
          const raster = document.createElement('canvas');
          raster.width = geometry.width ?? img.naturalWidth;
          raster.height = geometry.height ?? img.naturalHeight;
          const ctx = raster.getContext('2d');
          const crop = (!geometry.prepared && geometry.crop) || {
            x: 0,
            y: 0,
            width: img.naturalWidth,
            height: img.naturalHeight,
          };
          const scale = geometry.prepared ? 1 : (geometry.scale ?? 1);
          ctx.drawImage(
            img,
            crop.x,
            crop.y,
            crop.width,
            crop.height,
            0,
            0,
            Math.round(crop.width * scale),
            Math.round(crop.height * scale),
          );
          return {
            data: ctx.getImageData(0, 0, raster.width, raster.height).data,
            width: raster.width,
            height: raster.height,
          };
        }),
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
          canvas.width = images[0].width;
          canvas.height = images[0].height;
          const ctx = canvas.getContext('2d');
          ctx.putImageData(
            new ImageData(
              compose(
                images.map((img) => img.data),
                canvas.width,
                canvas.height,
                view.layers,
              ),
              canvas.width,
              canvas.height,
            ),
            0,
            0,
          );
          canvas.dataset.time = view.time;
          canvas.dataset.sourceX = geometry.crop?.x ?? 0;
          canvas.dataset.sourceY = geometry.crop?.y ?? 0;
          canvas.dataset.sourceScale = geometry.scale ?? 1;
          canvas.hidden = false;
          image.hidden = true;
          canvas.style.pointerEvents = '';
          canvas.removeAttribute('aria-busy');
          status.textContent =
            'Текущий кадр: ' + view.time.toFixed(3) + ' с · наложено кадров: ' + view.layers.length;
        } catch {
          if (token !== revision || !enabled) continue;
          cache.clear();
          canvas.hidden = true;
          image.hidden = false;
          canvas.removeAttribute('aria-busy');
          status.textContent =
            location.protocol === 'file:'
              ? 'Для наложения откройте отчёт через visual-story preview КАТАЛОГ_ОТЧЁТА. Браузер ограничивает чтение пикселей локальных файлов.'
              : 'Не удалось прочитать соседний кадр. Показан текущий; наложение можно включить снова.';
        }
      }
    } finally {
      running = false;
    }
  }
  function update() {
    revision++;
    // Keep one visual mode while decoding. Old pixels remain labelled with their own time.
    if (!enabled) {
      canvas.hidden = true;
      image.hidden = false;
    }
    canvas.style.pointerEvents = enabled ? 'none' : '';
    canvas.setAttribute('aria-busy', String(enabled));
    status.textContent = enabled
      ? (canvas.hidden ? '' : 'Показан ' + Number(canvas.dataset.time).toFixed(3) + ' с · ') +
        'подготовка ' +
        frames[index].time.toFixed(3) +
        ' с…'
      : '';
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
    root.querySelector('[data-onion-legend]').hidden = !enabled;
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
