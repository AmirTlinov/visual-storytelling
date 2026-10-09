import { SceneShell, mountScene, StepPlayer, widgetState } from '@visual-storytelling/core';
window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('ve-scene');
  const svg = root.querySelector('.ms-figure');
  const composition = document.createElement('div'),
    stage = document.createElement('div');
  stage.className = 've-stage';
  svg.replaceWith(stage);
  stage.append(svg);
  root.querySelector('h1').classList.add('ve-heading');
  composition.append(...root.childNodes);
  const sceneFrame = SceneShell.frame(composition, { width: 1280, height: 720, scope: 'scene' });
  root.append(sceneFrame.element);
  sceneFrame.resize();

  const detail = root.querySelector('[data-detail]');
  const stepLabel = root.querySelector('[data-step]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const input = [3, 5, 7, 9];
  const output = input.map((value) => value * 2);
  const empty = ['—', '—', '—', '—'];
  const phases = [
    {
      name: 'Подготовка',
      message: 'CPU готовит четыре числа: 3, 5, 7, 9.',
      memory: empty,
      cpu: input,
      gpu: empty,
      focus: 'cpu',
    },
    {
      name: 'Запись CPU',
      message: 'CPU записывает числа в общий буфер памяти.',
      memory: input,
      cpu: input,
      gpu: empty,
      focus: 'memory',
      transfer: 'cpu-write',
      values: input,
    },
    {
      name: 'Задание GPU',
      message: 'CPU ставит в очередь GPU задание: удвоить каждый элемент.',
      memory: input,
      cpu: input,
      gpu: empty,
      focus: 'gpu',
      transfer: 'dispatch',
    },
    {
      name: 'Чтение GPU',
      message: 'GPU читает четыре числа из общего буфера.',
      memory: input,
      cpu: input,
      gpu: input,
      focus: 'gpu',
      transfer: 'gpu-read',
      values: input,
    },
    {
      name: 'Вычисление',
      message: 'Четыре потока GPU умножают свои числа на два.',
      memory: input,
      cpu: input,
      gpu: output,
      focus: 'gpu',
      transfer: 'compute',
    },
    {
      name: 'Запись GPU',
      message: 'GPU записывает результат в тот же буфер памяти.',
      memory: output,
      cpu: input,
      gpu: output,
      focus: 'memory',
      transfer: 'gpu-write',
      values: output,
    },
    {
      name: 'Завершение',
      message: 'Работа GPU завершена — CPU может читать результат.',
      memory: output,
      cpu: input,
      gpu: output,
      focus: 'cpu',
      transfer: 'complete',
    },
    {
      name: 'Чтение CPU',
      message: 'CPU читает результат: 6, 10, 14, 18.',
      memory: output,
      cpu: output,
      gpu: output,
      focus: 'cpu',
      transfer: 'cpu-read',
      values: output,
    },
  ];
  let index = 0;
  let frame = null;
  let geometry;
  let controller;
  let mounted = false,
    restoring = false;
  const abort = new AbortController();

  const label = (x, y, value, small = false) =>
    `<text${small ? ' class="text-small"' : ''} x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle">${value}</text>`;
  const routeLabel = (x, value) =>
    `<rect x="${x - 44}" y="183" width="88" height="20" style="fill:var(--ve-surface)"/>${label(x, 193, value, true)}`;
  function box(x, y, w, h, active = false, seed = 0) {
    const lean = seed % 2 ? 0.6 : -0.6;
    return `<path class="ms-box${active ? ' ms-active' : ''}" d="M ${x + 3} ${y} Q ${x + w / 2} ${y - 1} ${x + w - 3} ${y + lean} Q ${x + w + 0.7} ${y} ${x + w} ${y + 4} L ${x + w + lean} ${y + h - 3} Q ${x + w} ${y + h + 0.5} ${x + w - 3} ${y + h} L ${x + 3} ${y + h + lean} Q ${x - 0.5} ${y + h} ${x} ${y + h - 3} L ${x + lean} ${y + 3} Q ${x} ${y} ${x + 3} ${y} Z"/>`;
  }
  function row(x, y, pitch, values, active, kind) {
    const tone = { cpu: 'blue', gpu: 'orange', memory: 'purple' }[kind];
    return (
      `<g class="ms-values" style="--ve-accent:var(--ve-${tone});--ve-wash:var(--ve-${tone}-wash)">` +
      values
        .map(
          (value, i) =>
            `${box(x + i * pitch, y, pitch - 4, 44, active, i)}<g data-slot="${kind}-${i}">${label(x + i * pitch + (pitch - 4) / 2, y + 22, value)}</g>`,
        )
        .join('') +
      '</g>'
    );
  }
  async function restore(snapshot) {
    const checkpoint = snapshot?.privateContent;
    if (!Number.isFinite(checkpoint?.time) || !Number.isInteger(checkpoint.values?.step)) return;
    restoring = true;
    try {
      await root.scene.restore(checkpoint);
    } catch (error) {
      detail.textContent = error.message;
    } finally {
      restoring = false;
    }
  }

  function persist() {
    if (!mounted || restoring) return;
    storage.save({
      modelContent: {
        visualization: 'shared-memory',
        step: index,
        phase: phases[index].name,
        input,
        memory: phases[index].memory,
        cpu: phases[index].cpu,
        gpu: phases[index].gpu,
      },
      privateContent: root.scene.capture(),
    });
  }

  function render() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    const s = phases[index];
    const w = 840;
    const margin = Math.max(8, (w - 680) / 2);
    const bodyWidth = Math.min(232, (w - 48) / 2);
    const cpuX = margin;
    const gpuX = w - margin - bodyWidth;
    const cpuCenter = cpuX + bodyWidth / 2;
    const gpuCenter = gpuX + bodyWidth / 2;
    const memPitch = Math.min(80, (w - 32) / 4);
    const memX = (w - memPitch * 4) / 2 + 2;
    const memLeft = memX + (memPitch - 4) / 2;
    const memRight = memX + 3 * memPitch + (memPitch - 4) / 2;
    const innerPitch = (bodyWidth - 14) / 4;
    const cpuPath = `M ${cpuCenter} 226 C ${cpuCenter} 164 ${memLeft} 169 ${memLeft} 104`;
    const gpuPath = `M ${gpuCenter} 226 C ${gpuCenter} 164 ${memRight} 169 ${memRight} 104`;
    const commandPath = `M ${cpuCenter} 350 L ${cpuCenter} 379 Q ${cpuCenter} 386 ${cpuCenter + 7} 386 L ${gpuCenter - 7} 386 Q ${gpuCenter} 386 ${gpuCenter} 379 L ${gpuCenter} 350`;
    geometry = { w, cpuX, gpuX, bodyWidth, innerPitch };
    const cpuRoute = s.transfer?.startsWith('cpu');
    const gpuRoute = s.transfer?.startsWith('gpu');
    const commandActive = ['dispatch', 'complete'].includes(s.transfer);
    const memValues = s.memory;
    const cpuCaption =
      index === 0
        ? 'исходные числа'
        : index === 7
          ? 'прочитано'
          : index === 6
            ? 'можно читать'
            : 'регистры';
    const gpuCaption =
      index < 2
        ? 'ждёт'
        : index === 2
          ? 'задание × 2'
          : index === 3
            ? 'прочитано'
            : index === 4
              ? '× 2'
              : index === 5
                ? 'запись'
                : 'готово';
    svg.setAttribute('viewBox', `0 0 ${w} 434`);
    svg.innerHTML = `<title id="ms-title">Общий буфер памяти, CPU и GPU</title>
          <desc id="ms-desc">${s.message} Память: ${s.memory.join(', ')}. Данные CPU: ${s.cpu.join(', ')}. Данные GPU: ${s.gpu.join(', ')}.</desc>
          ${label(w / 2, 28, 'Общая память · один буфер')}
          ${row(memX, 60, memPitch, memValues, s.focus === 'memory', 'memory')}
          <path data-route="cpu" class="ms-line${cpuRoute ? ' ms-data' : ''}" d="${cpuPath}"/>
          <path data-route="gpu" class="ms-line${gpuRoute ? ' ms-data' : ''}" d="${gpuPath}"/>
          ${routeLabel((cpuCenter + memLeft) / 2, cpuRoute ? (s.transfer === 'cpu-read' ? 'чтение ↓' : 'запись ↑') : 'данные ↕')}
          ${routeLabel((gpuCenter + memRight) / 2, gpuRoute ? (s.transfer === 'gpu-read' ? 'чтение ↓' : 'запись ↑') : 'данные ↕')}
          <g style="--ve-ink:var(--ve-blue)">${box(cpuX, 228, bodyWidth, 122)}</g>
          <g style="--ve-ink:var(--ve-orange)">${box(gpuX, 228, bodyWidth, 122)}</g>
          ${label(cpuCenter, 250, 'CPU')}
          ${label(gpuCenter, 250, 'GPU')}
          ${row(cpuX + 9, 268, innerPitch, s.cpu, s.focus === 'cpu', 'cpu')}
          ${row(gpuX + 9, 268, innerPitch, s.gpu, s.focus === 'gpu', 'gpu')}
          ${label(cpuCenter, 331, cpuCaption, true)}
          ${label(gpuCenter, 331, gpuCaption, true)}
          <path data-route="command" class="ms-line${commandActive ? ' ms-command' : ''}" stroke-dasharray="5 6" d="${commandPath}"/>
          ${label(w / 2, 414, s.transfer === 'dispatch' ? 'задание →' : s.transfer === 'complete' ? '← завершение' : 'команды и завершение', true)}
          <g data-packet aria-hidden="true"></g>`;
    detail.textContent = s.message;
    stepLabel.textContent = `Шаг ${index + 1} из ${phases.length}`;
  }
  function setSlot(kind, i, value) {
    svg.querySelector(`[data-slot="${kind}-${i}"] text`).textContent = value;
  }
  function transition(previous) {
    const s = phases[index];
    if (reduced.matches || !s.transfer) return;
    const packet = svg.querySelector('[data-packet]');
    if (s.transfer === 'compute') {
      const tracks = Array.from(svg.querySelectorAll('[data-slot^="gpu-"]'));
      tracks.forEach((_, i) => setSlot('gpu', i, previous.gpu[i]));
      const started = performance.now();
      function computeTick(now) {
        const t = Math.min(1, (now - started) / 820);
        tracks.forEach((node, i) => {
          node.setAttribute('transform', `translate(0,${-8 * Math.sin(Math.PI * t)})`);
          setSlot('gpu', i, t < 0.5 ? previous.gpu[i] : s.gpu[i]);
        });
        frame = t < 1 ? requestAnimationFrame(computeTick) : null;
      }
      computeTick(started);
      return;
    }
    const command = ['dispatch', 'complete'].includes(s.transfer);
    const routeName = command ? 'command' : s.transfer.startsWith('cpu') ? 'cpu' : 'gpu';
    const route = svg.querySelector(`[data-route="${routeName}"]`);
    const length = route.getTotalLength();
    const reverse = ['gpu-read', 'cpu-read', 'complete'].includes(s.transfer);
    let destination = null;
    if (!command) {
      destination = s.transfer.endsWith('write') ? 'memory' : routeName;
      previous[destination].forEach((value, i) => setSlot(destination, i, value));
    }
    const packetText = command
      ? s.transfer === 'dispatch'
        ? '× 2'
        : 'готово'
      : s.values.join('  ');
    const packetWidth = command ? 62 : Math.min(112, geometry.w / 4 + 8);
    packet.innerHTML = `<rect x="${-packetWidth / 2}" y="-14" width="${packetWidth}" height="28" rx="4" style="fill:var(--ve-surface);stroke:var(--${command ? 've-purple' : routeName === 'gpu' ? 've-orange' : 've-blue'});stroke-width:1.5"/>${label(0, 0, packetText, true)}`;
    const started = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - started) / 1000);
      const eased = t * t * (3 - 2 * t);
      const point = route.getPointAtLength((reverse ? 1 - eased : eased) * length);
      packet.setAttribute('transform', `translate(${point.x},${point.y})`);
      if (t < 1) frame = requestAnimationFrame(tick);
      else {
        packet.replaceChildren();
        if (destination) s[destination].forEach((value, i) => setSlot(destination, i, value));
        frame = null;
      }
    }
    tick(started);
  }
  function moveTo(target, animate = true) {
    const previousIndex = index;
    const previous = phases[index];
    index = Math.min(7, Math.max(0, target));
    render();
    if (animate && index === previousIndex + 1) transition(previous);
    persist();
  }
  const storage = widgetState('shared-memory', restore);
  reduced.addEventListener('change', () => render(), { signal: abort.signal });
  controller = StepPlayer.mount(root, {
    count: phases.length,
    initial: index,
    render: (target, _previous, animate) => moveTo(target, animate),
  });
  mounted = true;
  mountScene(
    root,
    {
      play: controller.play,
      pause: controller.pause,
      get playing() {
        return controller.playing;
      },
      snapshot: () => ({ step: index, ...phases[index] }),
      dispose() {
        mounted = false;
        controller.dispose();
        abort.abort();
        storage.dispose();
        sceneFrame.dispose();
        if (frame !== null) cancelAnimationFrame(frame);
        root.replaceChildren();
      },
    },
    {
      parameters: [
        { key: 'step', label: 'Шаг объяснения', value: 0, min: 0, max: phases.length - 1, step: 1 },
      ],
      values: () => ({ step: index }),
      setValues: ({ step }) => {
        if (step !== undefined) controller.go(Number(step));
      },
    },
  );
  await restore(storage.read());
})();
