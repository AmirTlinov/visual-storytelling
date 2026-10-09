/** Selection, responsive composition and narrative time for the BERT parameter view. */
export function mountCube(initial, start, api, model, cubeScene) {
  const { SvgOrbit, SketchInk, fitSvgControls, transport, mountScene } = api;
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
  let width = 1100;
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
    const phase =
      t < 2.65
        ? 'Умножаем входы на веса'
        : t < 3.7
          ? 'Складываем четыре вклада'
          : t < 5
            ? 'Учитываем 252 входа и b'
            : t < 6.3
              ? 'Собираем полный результат'
              : 'Компонента запроса готова';
    text('operation', phase);
    text('calculation-title', `2. Соберём q${'₁₂₃₄'[h]},${'₁₂₃₄'[j]} для токена`);
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
    text(
      'reading',
      t >= 6.3 ? 'Все 256 компонент и смещение b учтены.' : 'Проследи путь от входов к одному q.',
    );
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
          `<g id="token-${index}" data-token="${index}" role="option" aria-selected="${index === token}" aria-label="Токен ${index + 1}: ${escapeXML(value)}"><path class="token-outline"/><text text-anchor="middle">${escapeXML(value)}</text></g>`,
      )
      .join('');
  }
  function layout() {
    const small = root.getBoundingClientRect().width < 650;
    width = small ? 550 : 1100;
    const activationTop = small ? 1150 : 665;
    attr(byID('heading'), 'x', small ? 28 : 64);
    attr(byID('heading'), 'font-size', small ? 30 : 36);
    attr(byID('subtitle'), 'x', small ? 28 : 64);
    text(
      'subtitle',
      small
        ? 'BERT-mini · слой 4 · 64 видимых веса'
        : 'BERT-mini · слой 4 · показываем 64 коэффициента из 65 536',
    );
    attr(byID('matrix-section'), 'transform', small ? 'translate(35 670)' : 'translate(550 158)');
    attr(byID('activation-region'), 'transform', `translate(0 ${activationTop})`);
    const longest = Math.max(...data.tokens.map((value) => value.length));
    const columns = Math.min(
      data.tokens.length,
      Math.max(1, Math.floor((width - 72) / Math.max(116, longest * 14 + 24))),
    );
    const rows = Math.ceil(data.tokens.length / columns),
      slot = (width - 72) / columns;
    [...tokens.children].forEach((node, index) => {
      attr(
        node,
        'transform',
        `translate(${36 + ((index % columns) + 0.5) * slot} ${80 + Math.floor(index / columns) * 58})`,
      );
      attr(node.querySelector('path'), 'd', inkBox(-slot / 2 + 5, -30, slot - 10, 44, index));
    });
    const calculationY = 102 + (rows - 1) * 58;
    attr(byID('calculation'), 'transform', `translate(0 ${calculationY})`);
    const xs = small ? [38, 136, 215, 298, 377, 469] : [90, 250, 375, 515, 640, 815];
    for (let row = 0; row < 4; row++) {
      const y = 108 + row * 56;
      attr(byID(`calc-row-${row}`), 'transform', `translate(0 ${y})`);
      ['index', 'input', 'multiply', 'weight', 'equal', 'term'].forEach((key, col) =>
        attr(byID(`${key}-${row}`), 'x', xs[col]),
      );
      attr(byID(`input-box-${row}`), 'd', inkBox(xs[1] - 51, -30, 102, 43, row));
      attr(byID(`weight-box-${row}`), 'd', inkBox(xs[3] - 51, -30, 102, 43, row + 4));
      attr(byID(`product-box-${row}`), 'd', inkBox(xs[5] - 51, -30, 102, 43, row + 8));
      attr(
        byID(`calculation-flow-${row}`),
        'd',
        `M${xs[1]} 23Q${(xs[1] + xs[5]) / 2} 28 ${xs[5]} 23`,
      );
    }
    ['input-heading', 'weight-heading', 'term-heading'].forEach((key, col) =>
      attr(byID(key), 'x', xs[1 + col * 2]),
    );
    attr(byID('operation'), 'x', width / 2);
    attr(byID('operation'), 'font-size', small ? 21 : 25);
    const edge = xs[5] + 59,
      rail = edge + 10;
    attr(byID('gather-bracket'), 'd', `M${edge} 79H${rail}Q${rail + 0.6} 184 ${rail} 289H${edge}`);
    attr(byID('gather-shaft'), 'd', `M${xs[5]} 298Q${xs[5] + 0.3} 315 ${xs[5]} 331`);
    attr(byID('gather-head'), 'd', `M${xs[5] - 4.5} 325L${xs[5]} 331L${xs[5] + 4.5} 325`);
    ['partial', 'rest'].forEach((key, index) => {
      const y = 371 + index * 104;
      attr(byID(`${key}-box`), 'd', inkBox(38, y - 35, width - 76, 64, 50 + index));
      attr(byID(`${key}-label`), 'x', 60);
      attr(byID(`${key}-value`), 'x', width - 62);
    });
    ['plus', 'output-value', 'reading', 'rounding'].forEach((id) => attr(byID(id), 'x', width / 2));
    attr(byID('final-box'), 'd', inkBox(width / 2 - 186, 524, 372, 70, 62));
    const height = activationTop + calculationY + 708;
    attr(root, 'viewBox', `0 0 ${width} ${height}`);
    attr(root, 'height', height);
    root.style.aspectRatio = `${width} / ${height}`;
    if (window.frameElement) window.frameElement.style.aspectRatio = `${width} / ${height}`;
    fitSvgControls(root);
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
