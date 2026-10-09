import { SceneShell, mountScene } from '@visual-storytelling/core';
import { SvgLayout, rough, gsap, widgetState } from '@visual-storytelling/core';
window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('ve-scene'),
    svg = root.querySelector('svg.canvas');
  const composition = document.createElement('div'),
    stage = document.createElement('div');
  stage.className = 've-stage';
  svg.replaceWith(stage);
  stage.append(svg);
  root.querySelector('h1').classList.add('ve-heading');
  const toolbar = document.createElement('div');
  toolbar.className = 've-scene-toolbar';
  const modes = root.querySelector('.modes');
  modes.replaceWith(toolbar);
  toolbar.append(modes);
  const controls = document.createElement('div');
  controls.className = 'fraction-controls';
  root.querySelector('.partition').before(controls);
  controls.append(root.querySelector('.partition'), root.querySelector('.inputs'));
  composition.append(...root.childNodes);
  const sceneFrame = SceneShell.frame(composition, { width: 1280, height: 720, scope: 'scene' });
  root.append(sceneFrame.element);
  sceneFrame.resize();

  const { element: el, place } = SvgLayout,
    rc = rough.svg(svg);
  const find = (key) => root.querySelector(`[data-${key}]`),
    total = 12;
  const abort = new AbortController(),
    listen = { signal: abort.signal };
  const state = { parts: 3, taken: 2, mode: 'numbers' };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const width = 840;
  let first = true;
  svg.setAttribute('viewBox', `0 0 ${width} 420`);
  const movement = { progress: 1 };
  let movementFrom = [],
    restoredMovement;
  let settled = true;
  const chips = Array.from({ length: total }, (_, i) => {
    const node = el('g', { 'data-chip': i }),
      pose = { x: 0, y: 0 };
    node.append(
      rc.circle(0, 0, 23, {
        seed: i + 5,
        roughness: 0.6,
        stroke: 'var(--ve-ink)',
        strokeWidth: 1.5,
        disableMultiStroke: true,
        fill: 'var(--ve-wash)',
        fillStyle: 'solid',
      }),
    );
    find('chips').append(node);
    return { node, pose };
  });
  function text(value, x, y, cls = '') {
    const node = el('text', { class: cls, 'data-arrival': '' }, value);
    find('labels').append(node);
    place(node, x, y);
    return node;
  }
  function draw(animate = !settled) {
    gsap.killTweensOf(movement);
    const restored = restoredMovement;
    restoredMovement = undefined;
    const moving = !restored && animate && !first && !reduced.matches;
    movement.progress = restored?.progress ?? (moving ? 0 : 1);
    const starts = (movementFrom = restored?.from ?? chips.map(({ pose }) => ({ ...pose })));
    const targets = [];
    const perPart = total / state.parts,
      chosen = perPart * state.taken;
    const columns = [6, 4, 3, 2, 1].find(
      (n) => n <= Math.max(2, Math.floor(width / 160)) && state.parts % n === 0,
    );
    const rows = Math.ceil(state.parts / columns),
      slot = Math.min(190, (width - 16) / columns);
    const left = (width - slot * columns) / 2,
      top = 68 + (2 - rows) * 68.5,
      groupHeight = 137;
    find('guides').replaceChildren();
    find('labels').replaceChildren();
    const instruction = text('', width / 2, top - 45, 'note');
    instruction.removeAttribute('data-arrival');
    find('guides').append(
      el('path', { class: 'ink-line', d: `M${left + 6} ${top - 21}v-8H${width - left - 6}v8` }),
    );
    for (let part = 0; part < state.parts; part++) {
      const x = left + (part % columns) * slot + 5,
        y = top + Math.floor(part / columns) * groupHeight;
      const selected = part < state.taken;
      const guide = rc.rectangle(x, y, slot - 10, 116, {
        seed: part + 100,
        roughness: 0.4,
        stroke: 'var(--ve-pencil)',
        strokeWidth: 1.3,
        disableMultiStroke: true,
        fill: 'none',
        fillStyle: 'solid',
      });
      guide.dataset.part = part;
      find('guides').append(guide);
      text(
        state.mode === 'formulas'
          ? `12 / ${state.parts} = ${perPart}`
          : `${perPart} ${perPart === 6 ? 'фишек' : 'фишки'}`,
        x + (slot - 10) / 2,
        y + 96,
        'note',
      );
      const across = perPart === 6 ? 3 : 2,
        chipRows = Math.ceil(perPart / across);
      for (let j = 0; j < perPart; j++) {
        const item = chips[part * perPart + j];
        const target = {
          x: x + (slot - 10) / 2 + ((j % across) - (across - 1) / 2) * 33,
          y: y + 39 + (Math.floor(j / across) - (chipRows - 1) / 2) * 32,
        };
        targets.push({ item, target, selected });
      }
    }
    const baseline = top + rows * groupHeight + 7;
    text(
      `${state.taken}/${state.parts} × 12 = ${chosen}`,
      width / 2,
      baseline,
      'fraction-result orange',
    );
    if (state.mode === 'formulas')
      text('m/n × N — выбранная доля', width / 2, baseline + 37, 'note');
    find('taken').max = state.parts;
    find('taken').value = state.taken;
    find('taken').setAttribute('aria-valuetext', `${state.taken} из ${state.parts}`);
    find('count').textContent = `${state.taken} из ${state.parts}`;
    root
      .querySelectorAll('[data-parts]')
      .forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.parts) === state.parts));
    root
      .querySelectorAll('[data-mode]:not([data-parts])')
      .forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === state.mode));
    const description = `Всего 12 фишек. Равных частей: ${state.parts}, в каждой ${perPart}. Выбрано частей: ${state.taken}; фишек: ${chosen}.`;
    let published;
    function paint() {
      settled = movement.progress === 1;
      targets.forEach(({ item, target }, i) => {
        item.pose.x = starts[i].x + (target.x - starts[i].x) * movement.progress;
        item.pose.y = starts[i].y + (target.y - starts[i].y) * movement.progress;
        item.node.setAttribute('transform', `translate(${item.pose.x} ${item.pose.y})`);
      });
      if (published === settled) return;
      published = settled;
      root.dataset.phase = settled ? 'complete' : 'arranging';
      instruction.textContent = settled ? 'Всего 12 фишек' : 'Раскладываем 12 фишек поровну';
      place(instruction, width / 2, top - 45);
      find('labels')
        .querySelectorAll('[data-arrival]')
        .forEach((node) => {
          node.setAttribute('visibility', settled ? 'visible' : 'hidden');
        });
      targets.forEach(({ item, selected }) => {
        item.node.dataset.selected = settled && selected;
        item.node
          .querySelectorAll('path[fill]:not([fill="none"])')
          .forEach((path) =>
            path.setAttribute(
              'fill',
              settled && selected ? 'var(--ve-orange-soft)' : 'var(--ve-surface)',
            ),
          );
      });
      find('guides')
        .querySelectorAll('[data-part]')
        .forEach((guide) => {
          const chosen = settled && Number(guide.dataset.part) < state.taken;
          guide.querySelectorAll('path').forEach((path) => {
            path.setAttribute('fill', chosen ? 'var(--ve-orange-wash)' : 'none');
            path.setAttribute('stroke', chosen ? 'var(--ve-orange)' : 'var(--ve-pencil)');
          });
        });
      svg.querySelector('desc').textContent = settled
        ? description
        : 'Те же двенадцать фишек перемещаются в новые равные группы.';
      find('result').textContent = settled ? description : 'Перегруппировка двенадцати фишек.';
    }
    paint();
    if (moving)
      gsap.to(movement, {
        progress: 1,
        duration: 0.75,
        ease: 'power2.inOut',
        onUpdate: paint,
        onComplete: save,
      });
    first = false;
  }
  function save() {
    storage.save({
      modelContent: {
        example: 'fraction',
        total,
        ...state,
        result: (total / state.parts) * state.taken,
      },
      privateContent: scene.capture(),
    });
  }
  async function restore(snapshot) {
    const checkpoint = snapshot?.privateContent;
    if (checkpoint?.subject?.example !== 'fraction') return;
    try {
      await scene.restore(checkpoint);
    } catch (error) {
      find('result').textContent = error.message;
    }
  }
  const storage = widgetState('fraction-of-a-set', restore);
  root.querySelectorAll('[data-parts]').forEach((b) =>
    b.addEventListener(
      'click',
      () => {
        const parts = Number(b.dataset.parts);
        if (parts === state.parts) return;
        state.parts = parts;
        state.taken = Math.min(state.parts, state.taken);
        draw(true);
        save();
      },
      listen,
    ),
  );
  find('taken').addEventListener(
    'input',
    () => {
      state.taken = Number(find('taken').value);
      draw();
      save();
    },
    listen,
  );
  root.querySelectorAll('[data-mode]:not([data-parts])').forEach((b) =>
    b.addEventListener(
      'click',
      () => {
        state.mode = b.dataset.mode;
        draw();
        save();
      },
      listen,
    ),
  );
  reduced.addEventListener('change', () => draw(), listen);
  draw(false);
  const scene = mountScene(root, {
    subject: {
      capture: () => ({
        example: 'fraction',
        ...state,
        movement: { progress: movement.progress, from: movementFrom },
      }),
      restore(value) {
        const motion = value?.movement;
        if (
          value?.example !== 'fraction' ||
          ![2, 3, 4, 6].includes(value.parts) ||
          !Number.isInteger(value.taken) ||
          value.taken < 0 ||
          value.taken > value.parts ||
          !['numbers', 'formulas'].includes(value.mode) ||
          !Number.isFinite(motion?.progress) ||
          motion.progress < 0 ||
          motion.progress > 1 ||
          !Array.isArray(motion.from) ||
          motion.from.length !== total ||
          motion.from.some(
            (point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y),
          )
        )
          throw new Error('Сохранённые условия долей несовместимы с этой сценой.');
        Object.assign(state, { parts: value.parts, taken: value.taken, mode: value.mode });
        restoredMovement = structuredClone(motion);
        draw(false);
      },
    },
    snapshot: () => ({
      ...state,
      total,
      settled,
      result: settled ? (total / state.parts) * state.taken : null,
      positions: chips.map(({ pose }) => ({ ...pose })),
    }),
    dispose() {
      if (abort.signal.aborted) return;
      abort.abort();
      storage.dispose();
      sceneFrame.dispose();
      gsap.killTweensOf(movement);
      root.replaceChildren();
    },
  });
  await restore(storage.read());
})();
