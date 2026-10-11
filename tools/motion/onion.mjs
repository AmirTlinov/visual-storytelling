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
      opacity: i === index ? 1 : 0.5 * Math.max(0, 1 - Math.abs(frames[i].time - time) / radius),
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
      weight = 0;
    const presentAlpha = present[p + 3] / 255;
    for (let i = 0; i < layers.length; i++) {
      const data = rasters[i],
        tint = tints[i];
      if (!tint) continue;
      const alpha = data[p + 3] / 255;
      const delta = Math.max(
        Math.abs(data[p] * alpha - present[p] * presentAlpha),
        Math.abs(data[p + 1] * alpha - present[p + 1] * presentAlpha),
        Math.abs(data[p + 2] * alpha - present[p + 2] * presentAlpha),
        Math.abs(data[p + 3] - present[p + 3]),
      );
      const w = alpha * layers[i].opacity * Math.min(1, Math.max(0, delta - 8) / 96);
      r += (data[p] * 0.2 + tint[0] * 0.8) * w;
      g += (data[p + 1] * 0.2 + tint[1] * 0.8) * w;
      b += (data[p + 2] * 0.2 + tint[2] * 0.8) * w;
      weight += w;
    }
    // Bound the entire trail, rather than letting many neighbours obscure current text.
    const ghost = Math.min(0.28, weight * 0.55);
    const a = ghost + presentAlpha * (1 - ghost);
    if (a) {
      const retained = presentAlpha * (1 - ghost),
        blend = weight ? ghost / weight : 0;
      output[p] = (r * blend + present[p] * retained) / a;
      output[p + 1] = (g * blend + present[p + 1] * retained) / a;
      output[p + 2] = (b * blend + present[p + 2] * retained) / a;
      output[p + 3] = a * 255;
    }
  }
  return output;
}

/** A continuous visual cue; the local rate comparison never declares an animation defective. */
export function temporalChangeStrength(change) {
  return 0.18 + 0.82 * Math.max(0, Math.min(1, ((change?.magnitude ?? 1) - 1) / 4));
}

/** Highlight only observed differences. Preserve the after-frame's detail and empty alpha. */
export function composeChange(before, after, width, height, strength = 1) {
  const output = new Uint8ClampedArray(after);
  const tint = [33, 184, 100];
  for (let p = 0; p < width * height * 4; p += 4) {
    const a = before[p + 3] / 255,
      b = after[p + 3] / 255;
    const delta = Math.max(
      Math.abs(before[p] * a - after[p] * b),
      Math.abs(before[p + 1] * a - after[p + 1] * b),
      Math.abs(before[p + 2] * a - after[p + 2] * b),
      Math.abs(before[p + 3] - after[p + 3]),
    );
    const amount =
      0.36 * Math.max(0, Math.min(1, strength)) * Math.min(1, Math.max(0, delta - 8) / 128);
    if (!amount) continue;
    const alpha = amount + b * (1 - amount);
    for (let c = 0; c < 3; c++)
      output[p + c] = (tint[c] * amount + after[p + c] * b * (1 - amount)) / alpha;
    output[p + 3] = alpha * 255;
  }
  return output;
}

/** A view of the existing player's clock. Decode only the states visible in this mode. */
export function installOnionPlayer(
  root,
  frames,
  selectLayers,
  compose,
  geometry,
  stop,
  changePixels,
  changeStrength,
  changes,
) {
  const image = root.querySelector('img');
  const canvas = root.querySelector('[data-onion-canvas]');
  const controls = [...root.querySelectorAll('[data-view]')];
  const windowControl = root.querySelector('[data-onion-window]');
  const input = windowControl.querySelector('input');
  const status = root.querySelector('[data-onion-status]');
  const legend = root.querySelector('[data-onion-legend]');
  const greenLegend = root.querySelector('[data-change-legend]');
  const byTime = new Map(changes.map((change) => [change.endTime ?? change.time, change]));
  let radius = geometry.radius;
  input.value = Number(radius.toPrecision(6));
  let index = 0,
    mode = 'frame',
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
  function reflectMode() {
    root.dataset.mode = mode;
    controls.forEach((control) =>
      control.setAttribute('aria-pressed', String(control.dataset.view === mode)),
    );
    windowControl.hidden = mode !== 'onion';
    legend.hidden = mode !== 'onion';
    greenLegend.hidden = mode !== 'change';
    status.hidden = mode === 'frame';
  }
  async function render() {
    if (running) return;
    running = true;
    try {
      while (pending && mode !== 'frame') {
        pending = false;
        const token = revision;
        const view = selectLayers(frames, { at: frames[index].time, radius });
        const selectedMode = mode;
        const indices =
          mode === 'onion'
            ? view.layers.map((layer) => layer.index)
            : [Math.max(0, index - 1), index];
        const keep = new Set(indices);
        for (const i of cache.keys()) if (!keep.has(i)) cache.delete(i);
        try {
          const images = await Promise.all(indices.map(load));
          if (token !== revision || mode === 'frame') continue;
          canvas.width = images[0].width;
          canvas.height = images[0].height;
          const change = byTime.get(frames[index].time);
          const pixels =
            selectedMode === 'onion'
              ? compose(
                  images.map((img) => img.data),
                  canvas.width,
                  canvas.height,
                  view.layers,
                )
              : changePixels(
                  images[0].data,
                  images[1].data,
                  canvas.width,
                  canvas.height,
                  changeStrength(change),
                );
          canvas
            .getContext('2d')
            .putImageData(new ImageData(pixels, canvas.width, canvas.height), 0, 0);
          canvas.dataset.time = view.time;
          canvas.dataset.sourceX = geometry.crop?.x ?? 0;
          canvas.dataset.sourceY = geometry.crop?.y ?? 0;
          canvas.dataset.sourceScale = geometry.scale ?? 1;
          canvas.hidden = false;
          image.hidden = true;
          canvas.style.pointerEvents = '';
          canvas.removeAttribute('aria-busy');
          status.textContent =
            selectedMode === 'onion'
              ? 'Текущий кадр: ' +
                view.time.toFixed(3) +
                ' с · наложено кадров: ' +
                view.layers.length
              : index === 0
                ? 'Первый кадр записи: предыдущего кадра нет.'
                : frames[index - 1].time.toFixed(3) +
                  ' → ' +
                  view.time.toFixed(3) +
                  ' с' +
                  (change?.candidate
                    ? ' · резкое изменение относительно соседних переходов'
                    : ' · изменившиеся области');
        } catch {
          if (token !== revision || mode === 'frame') continue;
          cache.clear();
          mode = 'frame';
          reflectMode();
          status.hidden = false;
          canvas.hidden = true;
          image.hidden = false;
          canvas.removeAttribute('aria-busy');
          status.textContent =
            location.protocol === 'file:'
              ? 'Показан чёткий кадр. Для наложений откройте отчёт через visual-story preview КАТАЛОГ_ОТЧЁТА.'
              : 'Не удалось прочитать соседний кадр. Показан чёткий кадр; попробуйте включить слой ещё раз.';
        }
      }
    } finally {
      running = false;
    }
  }
  function update() {
    revision++;
    if (mode === 'frame') {
      canvas.hidden = true;
      image.hidden = false;
      canvas.removeAttribute('aria-busy');
    } else canvas.setAttribute('aria-busy', 'true');
    canvas.style.pointerEvents = mode === 'frame' ? '' : 'none';
    status.textContent =
      mode === 'frame'
        ? ''
        : (canvas.hidden ? '' : 'Показан ' + Number(canvas.dataset.time).toFixed(3) + ' с · ') +
          'подготовка ' +
          frames[index].time.toFixed(3) +
          ' с…';
    pending = mode !== 'frame';
    if (pending) void render();
  }
  function setMode(value) {
    if (value === mode) return;
    mode = value;
    reflectMode();
    update();
    if (mode === 'frame') cache.clear();
  }
  root.addEventListener('motionframe', (event) => {
    index = event.detail.index;
    update();
  });
  root.addEventListener('motionview', (event) => {
    if (['frame', 'onion', 'change'].includes(event.detail.mode)) setMode(event.detail.mode);
  });
  controls.forEach((control) => {
    control.onclick = () => {
      stop();
      setMode(control.dataset.view === mode ? 'frame' : control.dataset.view);
    };
  });
  input.onchange = () => {
    if (!Number.isFinite(input.valueAsNumber) || input.valueAsNumber <= 0) {
      input.value = radius;
      return;
    }
    radius = input.valueAsNumber;
    stop();
    update();
  };
  reflectMode();
}
