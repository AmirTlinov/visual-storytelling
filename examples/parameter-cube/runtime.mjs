/** Selection, responsive composition and narrative time for the BERT parameter view. */
export function mountCube(initial, start, api, model, cubeScene) {
  const { SvgOrbit, SketchInk, transport, mountScene } = api;
  const { projectionBreakdown, validateProjection, decimal, weightColor, escapeXML } = model;
  const { inkShape, inkBox } = SketchInk;
  const root = document.querySelector('svg.ve-scene'),
    byID = (id) => document.getElementById(id);
  const lifetime = new AbortController(),
    listen = { signal: lifetime.signal };
  const parameters = initial.parameters,
    duration = 7.2;
  let data = initial,
    { selected, token, spread, yaw, pitch } = start;
  const stage = byID('stage'),
    notation = byID('notation'),
    tokens = byID('tokens');
  const attr = (node, name, value) => {
    if (node.getAttribute(name) !== String(value)) node.setAttribute(name, value);
  };
  const text = (id, value) => {
    if (byID(id).textContent !== String(value)) byID(id).textContent = value;
  };
  const show = (id, visible) => attr(byID(id), 'visibility', visible ? 'visible' : 'hidden');
  const clock = transport({ duration });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const cells = new Map(
    [...byID('cells').children].map((node) => [
      node.dataset.cell,
      { node, faces: [...node.children] },
    ]),
  );
  function drawCube() {
    let cursor = byID('cells').firstElementChild;
    for (const cell of cubeScene(parameters, spread, yaw, pitch, selected, inkShape, weightColor)) {
      const cached = cells.get(cell.key);
      cell.faces.forEach((face, i) =>
        Object.entries(face).forEach(([key, value]) => attr(cached.faces[i], key, value)),
      );
      if (cached.node !== cursor) byID('cells').insertBefore(cached.node, cursor);
      cursor = cached.node.nextElementSibling;
    }
  }
  function drawCalculation() {
    const values = projectionBreakdown(data, selected, token),
      t = clock.state.time;
    const { i, j, h, inputs, weights, terms, partial, rest, output } = values;
    const ends = [1, 1.55, 2.1, 2.65];
    text('calculation-title', `Компонента q${'₁₂₃₄'[h]},${'₁₂₃₄'[j]}`);
    text('weight-heading', `Вес → q${'₁₂₃₄'[j]}`);
    for (let row = 0; row < 4; row++) {
      text(`input-${row}`, decimal(inputs[row]));
      text(`weight-${row}`, decimal(weights[row]));
      text(`term-${row}`, decimal(terms[row]));
      attr(byID(`calc-row-${row}`), 'data-selected', row === i);
      const p = Math.max(0, Math.min(1, (t - ends[row] + 0.45) / 0.45));
      show(`product-${row}`, p === 1);
      const path = byID(`calculation-flow-${row}`);
      attr(path, 'stroke-dasharray', `${p * 100} 100`);
      attr(path, 'visibility', !reducedMotion.matches && p > 0 && p < 1 ? 'visible' : 'hidden');
    }
    const gather = Math.max(0, Math.min(1, (t - 2.8) / 0.9));
    attr(byID('gather-bracket'), 'stroke-dasharray', `${Math.min(1, gather / 0.6) * 100} 100`);
    const arrow = Math.max(0, (gather - 0.6) / 0.4);
    const gatherVisible = reducedMotion.matches ? t >= 3.7 : gather > 0;
    attr(byID('gather-shaft'), 'stroke-dasharray', `${arrow * 100} 100`);
    show('gather-arrow', gatherVisible && arrow > 0);
    show('gather-head', gatherVisible && arrow >= 1);
    show('gather', gatherVisible);
    show('partial', t >= 3.7);
    show('rest', t >= 5);
    show('plus', t >= 5);
    show('final', t >= 6.3);
    text('partial-value', decimal(partial));
    text('rest-value', decimal(rest));
    text('output-value', `q${'₁₂₃₄'[h]},${'₁₂₃₄'[j]} ≈ ${decimal(output)}`);
    attr(
      root,
      'data-calculation-phase',
      t < 2.65
        ? 'products'
        : t < 3.7
          ? 'sum'
          : t < 5
            ? 'remainder'
            : t < 6.3
              ? 'output'
              : 'complete',
    );
  }
  function updateSelection(reset = false) {
    const [i, j, h] = selected.split('-').map(Number);
    [...notation.children].forEach((group, head) => {
      group.style.display = head === h ? '' : 'none';
      attr(group, 'aria-hidden', head !== h);
    });
    notation.querySelectorAll('[data-cell]').forEach((node) => {
      const [, column, head] = node.dataset.cell.split('-').map(Number);
      attr(node, 'aria-selected', node.dataset.cell === selected);
      attr(node, 'data-column', head === h && column === j);
    });
    attr(notation, 'aria-activedescendant', `entry-${selected}`);
    byID('heads')
      .querySelectorAll('[data-head]')
      .forEach((node) => attr(node, 'aria-pressed', Number(node.dataset.head) === h));
    text(
      'component',
      `W_Q[${i + 1},${j + 1},${h + 1}] = ${decimal(parameters.values[h][i][j], 6)}`,
    );
    text('head-caption', `Голова ${h + 1} · столбец ${j + 1} → q${'₁₂₃₄'[j]}`);
    tokens
      .querySelectorAll('[data-token]')
      .forEach((node) => attr(node, 'aria-selected', Number(node.dataset.token) === token));
    attr(tokens, 'aria-activedescendant', `token-${token}`);
    layoutTokens();
    if (reset) {
      clock.pause();
      clock.seek(0);
    }
    drawCalculation();
    drawCube();
  }
  function selectCell(key) {
    setConditions({ ...conditions(), selected: key });
  }
  const conditions = () => ({ selected, token, spread });
  function validateConditions(next, projection = data) {
    if (
      !next ||
      !cells.has(next.selected) ||
      !Number.isInteger(next.token) ||
      next.token < 0 ||
      next.token >= projection.tokens.length ||
      !Number.isFinite(next.spread) ||
      next.spread < 0 ||
      next.spread > 1
    )
      throw new Error('Choose an existing coefficient, token and spread in [0,1]');
    return next;
  }
  function setConditions(next, restart) {
    validateConditions(next);
    const calculationChanged = token !== next.token || selected.slice(2) !== next.selected.slice(2);
    ({ selected, token, spread } = next);
    byID('layers-input').value = spread;
    updateSelection(restart ?? calculationChanged);
  }
  function drawTokens() {
    tokens.innerHTML = data.tokens
      .map(
        (value, index) =>
          `<g id="token-${index}" data-token="${index}" role="option" aria-selected="${index === token}" aria-label="Токен ${index + 1}: ${escapeXML(value)}"><title>${escapeXML(value)}</title><path class="token-outline"/><text text-anchor="middle">${escapeXML(value)}</text></g>`,
      )
      .join('');
  }
  function layoutTokens() {
    const count = Math.min(6, data.tokens.length);
    const first = Math.max(0, Math.min(token - Math.floor(count / 2), data.tokens.length - count));
    const slot = 1152 / count;
    show('token-paging', data.tokens.length > count);
    attr(byID('token-prev'), 'aria-disabled', token === 0);
    attr(byID('token-next'), 'aria-disabled', token === data.tokens.length - 1);
    [...tokens.children].forEach((node, index) => {
      node.style.display = index >= first && index < first + count ? '' : 'none';
      attr(node, 'transform', `translate(${64 + (index - first + 0.5) * slot} 93)`);
      attr(node.querySelector('path'), 'd', inkBox(-slot / 2 + 8, -30, slot - 16, 44, index));
      const label = node.querySelector('text');
      label.textContent = data.tokens[index];
      // Keep a fixed token strip; its accessible name retains the complete token.
      while (label.getComputedTextLength() > slot - 32 && label.textContent.length > 2)
        label.textContent = label.textContent.replace(/…$/, '').slice(0, -1) + '…';
    });
  }
  function layout() {
    layoutTokens();
    const xs = [10, 76, 160, 244, 332, 437];
    for (let row = 0; row < 4; row++) {
      attr(byID(`calc-row-${row}`), 'transform', `translate(0 ${90 + row * 48})`);
      ['index', 'input', 'multiply', 'weight', 'equal', 'term'].forEach((key, col) =>
        attr(byID(`${key}-${row}`), 'x', xs[col]),
      );
      attr(byID(`input-box-${row}`), 'd', inkBox(xs[1] - 51, -30, 102, 43, row));
      attr(byID(`weight-box-${row}`), 'd', inkBox(xs[3] - 51, -30, 102, 43, row + 4));
      attr(byID(`product-box-${row}`), 'd', inkBox(xs[5] - 51, -30, 102, 43, row + 8));
      attr(
        byID(`calculation-flow-${row}`),
        'd',
        `M${xs[1]} 18Q${(xs[1] + xs[5]) / 2} 22 ${xs[5]} 18`,
      );
    }
    ['input-heading', 'weight-heading', 'term-heading'].forEach((key, col) => {
      attr(byID(key), 'x', xs[1 + col * 2]);
      attr(byID(key), 'y', 46);
    });
    attr(byID('gather-bracket'), 'd', 'M495 61H505V248H495');
    attr(byID('gather-shaft'), 'd', 'M437 249V282');
    attr(byID('gather-head'), 'd', 'M432 276L437 282L442 276');
    ['partial', 'rest'].forEach((key, index) => {
      attr(byID(`${key}-box`), 'd', inkBox(0, 282 + index * 70, 532, 54, 50 + index));
    });
    attr(byID('final-box'), 'd', inkBox(70, 420, 392, 68, 62));
    drawCalculation();
  }
  const orbit = SvgOrbit.mount(root, stage, byID('orbit-world'), {
    yaw,
    pitch,
    pitchLimits: [-1.25, 1.25],
    changed(pose) {
      yaw = pose.yaw;
      pitch = pose.pitch;
      drawCube();
    },
    select(target) {
      const cell = target.closest('[data-cell]');
      if (cell) selectCell(cell.dataset.cell);
    },
  });
  byID('layers-input').addEventListener(
    'input',
    (event) => {
      setConditions({ ...conditions(), spread: event.target.valueAsNumber });
    },
    listen,
  );
  notation.addEventListener(
    'click',
    (event) => {
      const entry = event.target.closest('[data-cell]');
      if (entry) {
        selectCell(entry.dataset.cell);
        notation.focus({ preventScroll: true });
      }
    },
    listen,
  );
  notation.addEventListener(
    'keydown',
    (event) => {
      const move = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [1, -1],
        ArrowRight: [1, 1],
        PageUp: [2, -1],
        PageDown: [2, 1],
      }[event.key];
      if (!move) return;
      event.preventDefault();
      const indices = selected.split('-').map(Number);
      indices[move[0]] = Math.max(0, Math.min(3, indices[move[0]] + move[1]));
      selectCell(indices.join('-'));
    },
    listen,
  );
  function chooseHead(event) {
    const node = event.target.closest('[data-head]');
    if (!node) return;
    const indices = selected.split('-');
    indices[2] = node.dataset.head;
    selectCell(indices.join('-'));
  }
  byID('heads').addEventListener('click', chooseHead, listen);
  byID('heads').addEventListener(
    'keydown',
    (event) => {
      if (['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        chooseHead(event);
      }
    },
    listen,
  );
  for (const [id, direction] of [
    ['token-prev', -1],
    ['token-next', 1],
  ]) {
    const change = () =>
      setConditions(
        {
          ...conditions(),
          token: Math.max(0, Math.min(data.tokens.length - 1, token + direction)),
        },
        true,
      );
    byID(id).addEventListener('click', change, listen);
    byID(id).addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          change();
        }
      },
      listen,
    );
  }
  tokens.addEventListener(
    'click',
    (event) => {
      const node = event.target.closest('[data-token]');
      if (node) {
        setConditions({ ...conditions(), token: Number(node.dataset.token) }, true);
        tokens.focus({ preventScroll: true });
      }
    },
    listen,
  );
  tokens.addEventListener(
    'keydown',
    (event) => {
      let next;
      if (event.key === 'ArrowLeft') next = Math.max(0, token - 1);
      else if (event.key === 'ArrowRight') next = Math.min(data.tokens.length - 1, token + 1);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = data.tokens.length - 1;
      else return;
      event.preventDefault();
      setConditions({ ...conditions(), token: next }, true);
    },
    listen,
  );
  stage.addEventListener(
    'keydown',
    (event) => {
      const axis = 'ijh'.indexOf(event.key.toLowerCase());
      if (axis < 0) return;
      event.preventDefault();
      const indices = selected.split('-').map(Number);
      indices[axis] = (indices[axis] + (event.shiftKey ? 3 : 1)) % 4;
      selectCell(indices.join('-'));
    },
    listen,
  );
  root.addEventListener('pointerdown', () => root.classList.add('pointer-input'), {
    ...listen,
    capture: true,
  });
  root.addEventListener('keydown', () => root.classList.remove('pointer-input'), {
    ...listen,
    capture: true,
  });
  window.addEventListener('resize', layout, listen);
  reducedMotion.addEventListener('change', drawCalculation, listen);
  window.getProjection = () => data;
  window.setPending = (value) => {
    byID('activation-region').classList.toggle('pending', value);
    if (value) clock.pause();
  };
  function replaceProjection(next, inputs, time) {
    validateProjection(next, initial);
    validateConditions(inputs, next);
    clock.pause();
    data = next;
    ({ selected, token, spread } = inputs);
    byID('layers-input').value = spread;
    window.setPending(false);
    drawTokens();
    layout();
    updateSelection();
    clock.seek(time);
    text(
      'provenance',
      JSON.stringify({
        model: data.model,
        revision: data.revision,
        layer: data.layer,
        text: data.text,
        parameter_sha256: parameters.sha256,
      }),
    );
  }
  window.setProjection = (next) =>
    replaceProjection(
      next,
      {
        ...conditions(),
        token: Math.min(token, (next?.tokens?.length ?? 0) - 1),
      },
      0,
    );
  const unsubscribe = clock.subscribe(drawCalculation);
  mountScene(
    root,
    {
      camera: orbit,
      subject: {
        capture: () => ({ projection: data, ...conditions() }),
        restore(value, { time }) {
          replaceProjection(value?.projection, value, time);
        },
      },
      transport: clock,
      svg: () => root,
      get playing() {
        return clock.state.playing;
      },
      duration,
      checkpoints: [0, 1, 2.65, 3.7, 5, 6.3, duration],
      play: clock.play,
      pause: clock.pause,
      seek(time) {
        clock.pause();
        clock.seek(time);
      },
      get currentTime() {
        return clock.state.time;
      },
      snapshot: () => ({
        selected,
        token,
        spread,
        view: orbit.pose,
        time: clock.state.time,
        ...projectionBreakdown(data, selected, token),
      }),
      dispose() {
        if (lifetime.signal.aborted) return;
        lifetime.abort();
        unsubscribe();
        clock.dispose();
        orbit.dispose();
        delete window.getProjection;
        delete window.setPending;
        delete window.setProjection;
      },
    },
    {
      get parameters() {
        return [
          {
            key: 'selected',
            label: 'Коэффициент',
            value: selected,
            type: 'choice',
            options: [...cells.keys()].map((key) => ({
              value: key,
              label: `W_Q[${key
                .split('-')
                .map(Number)
                .map((i) => i + 1)
                .join(',')}]`,
            })),
          },
          {
            key: 'token',
            label: 'Токен',
            value: token,
            type: 'choice',
            options: data.tokens.map((label, value) => ({ value, label })),
          },
          {
            key: 'spread',
            label: 'Раздвинуть головы',
            value: spread,
            type: 'range',
            min: 0,
            max: 1,
            step: 0.02,
          },
        ];
      },
      values: conditions,
      setValues: (patch) => setConditions({ ...conditions(), ...patch }),
    },
  );
  drawTokens();
  layout();
  updateSelection();
  drawCube();
  window.galleryReady = document.fonts.ready.then(() => {
    if (!lifetime.signal.aborted) layout();
  });
}
