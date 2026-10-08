import { SceneShell, widgetState } from '@visual-storytelling/core';
import { predictionPrompt } from '@visual-storytelling/core/controls';
import '@visual-storytelling/core/style.css';
import './subject.css';
import timing from './timeline.json' with { type: 'json' };
import { binary, bit, act, storyState, explanation, memoryCheckpoint } from './memory.js';
import { registerDrawing, feedbackDrawing } from './drawing.js';

window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.querySelector('#ve-scene');
  // One notebook sheet contains the heading, drawing, notes and bottom transport.
  const shell = SceneShell.mount(root, {
    title: 'Как 8 бит запоминают число',
    // Below 904px, scaling the 17px toolbar would make its text smaller than 12px.
    frame: { width: 1280, height: 720, scope: 'scene', responsiveBelow: 904 },
  });
  shell.stage.classList.add('memory-sheet');
  const drawingHost = document.createElement('div');
  drawingHost.className = 'memory-drawing';
  shell.stage.append(drawingHost);
  const notes = document.createElement('div');
  notes.className = 'memory-notes';
  notes.innerHTML = [
    '<p class="sr-only">Вход <output id="input-value">0</output>. Память <output id="saved-value">0</output>.</p>',
    '<div class="memory-toolbar"><div class="memory-presets"><span>Вход:</span>',
    ...[42, 165, 255, 0].map(
      (v) => '<button type="button" data-value="' + v + '">' + v + '</button>',
    ),
    '</div>',
    '<p class="sr-only" id="event" role="status" aria-live="polite"></p>',
    '<div class="memory-actions"><button type="button" id="challenge-start">Предскажи результат</button><button type="button" id="reset">Сбросить</button><button type="button" data-panel="inside">Как хранится бит?</button><button type="button" data-panel="trace-panel">История тактов</button></div></div>',
    '<section id="challenge" class="memory-challenge" hidden><div id="prediction"></div><div class="memory-actions">',
    '<button id="next-challenge" type="button" hidden>Разрешим запись</button><button id="free" type="button">К опыту</button>',
    '</div></section>',
    '<section class="memory-panel memory-detail" id="inside" hidden tabindex="-1" aria-labelledby="inside-title"><div class="memory-panel-heading"><h2 id="inside-title">Почему один бит удерживает значение?</h2><button type="button" data-close-panel>К схеме</button></div><p id="detail-bit"></p><div id="feedback-drawing"></div><p id="loop-explanation"></p>',
    '<p>Это сердце запоминающего элемента. Управляемые входы D-триггера позволяют переключить его по фронту такта. Регистр удерживает данные, пока есть питание.</p></section>',
    '<section class="memory-panel" id="trace-panel" hidden tabindex="-1" aria-labelledby="trace-title"><div class="memory-panel-heading"><h2 id="trace-title">Последние переключения такта</h2><button type="button" data-close-panel>К схеме</button></div><table class="memory-trace"><thead><tr><th>Такт</th><th>WE</th><th>Вход D</th><th>Память Q</th></tr></thead><tbody id="trace"></tbody></table></section>',
  ].join('');
  const $ = (id) => root.querySelector('#' + id);
  let renderedPanel = null,
    panelOpener = null;
  function renderPanel(id, focus, selected) {
    if (id === renderedPanel) return;
    if (id) {
      const active = document.activeElement;
      panelOpener =
        root.contains(active) &&
        (active.getAttribute('data-panel') === id ||
          (id === 'inside' && active.hasAttribute('data-select')))
          ? active
          : root.querySelector(
              id === 'inside' ? `[data-select="${selected}"]` : `[data-panel="${id}"]`,
            );
    }
    renderedPanel = id;
    drawingHost.style.visibility = id ? 'hidden' : '';
    drawingHost.inert = Boolean(id);
    shell.stage.dataset.panel = id ?? 'register';
    for (const panel of notes.querySelectorAll('.memory-panel')) panel.hidden = panel.id !== id;
    if (focus) {
      if (id) $(id).focus({ preventScroll: true });
      else panelOpener?.focus({ preventScroll: true });
    }
  }
  const drawing = registerDrawing(drawingHost, dispatch, (index) => {
    dispatch({ type: 'panel', value: 'inside', index });
  });
  shell.stage.append(notes);
  const loop = feedbackDrawing($('feedback-drawing'));
  const presets = [...root.querySelectorAll('[data-value]')];
  const prediction = predictionPrompt($('prediction'), {
    choices: [42, 165, 0].map((value) => ({ value, label: String(value) })),
    runLabel: 'Проверить фронтом ↑',
    onChoose: (value) => dispatch({ type: 'guess', value }),
    onRun: () => dispatch({ type: 'clock' }),
  });
  let lastNotice = '',
    lastTrace = '';
  const story = shell.attachStory({
    audio: root.querySelector('[data-audio]'),
    script: timing,
    stateAt: storyState,
    checkpoint: memoryCheckpoint,
    render(s, frame, mode) {
      notes.hidden = mode === 'story' && !frame.has('your_turn');
      renderPanel(s.panel || null, mode === 'explore', s.selected);
      drawing.render(s, frame, mode);
      const quiz = Boolean(s.challenge);
      presets.forEach((button) => (button.disabled = quiz));
      $('input-value').textContent = s.input;
      $('saved-value').textContent = s.saved;
      $('challenge-start').hidden = quiz;
      $('reset').disabled = quiz && !s.checked;
      const message = explanation(s);
      if (message !== lastNotice) {
        $('event').textContent = message;
        lastNotice = message;
      }
      $('challenge').hidden = !quiz || Boolean(s.panel);
      $('next-challenge').hidden = !s.checked || s.challenge === 'write';
      prediction.render({
        question: 'После фронта ↑ в памяти будет…',
        guess: s.guess,
        checked: s.checked,
        feedback:
          (s.guess === s.saved ? 'Верно. ' : 'Твой прогноз: ' + s.guess + '. ') +
          'Получилось ' +
          s.saved +
          '. ' +
          (s.we ? 'WE = 1 и фронт ↑ записали байт.' : 'WE = 0 сохранил прежний байт.'),
      });
      const q = bit(s.saved, s.selected);
      $('detail-bit').textContent =
        'Бит ' +
        s.selected +
        ' (вес ' +
        2 ** s.selected +
        '): вход D = ' +
        bit(s.input, s.selected) +
        ', хранится Q = ' +
        q +
        '.';
      loop.render(q);
      $('loop-explanation').textContent =
        'Первое НЕ превращает ' +
        q +
        ' в ' +
        (1 - q) +
        '. Второе НЕ возвращает ' +
        q +
        '. Петля поддерживает сама себя: ' +
        q +
        ' → ' +
        (1 - q) +
        ' → ' +
        q +
        '.';
      const trace = s.trace.length
        ? s.trace
            .map(
              (t) =>
                '<tr><td>' +
                t.edge +
                '</td><td>' +
                Number(t.we) +
                '</td><td>' +
                t.input +
                '</td><td>' +
                t.saved +
                '</td></tr>',
            )
            .join('')
        : '<tr><td colspan="4">Такт ещё не переключался.</td></tr>';
      if (trace !== lastTrace) {
        $('trace').innerHTML = trace;
        lastTrace = trace;
      }
    },
  });
  root.querySelector('.modes').hidden = false;
  root.querySelector('[data-mode="story"]').textContent = 'Объяснение · 1 мин';
  root.querySelector('[data-mode="explore"]').textContent = 'Свободный опыт';
  function dispatch(action) {
    story.explore(act(story.requested.values, action));
    persist();
  }
  presets.forEach(
    (button) =>
      (button.onclick = () => dispatch({ type: 'input', value: Number(button.dataset.value) })),
  );
  $('reset').onclick = () => dispatch({ type: 'reset' });
  $('challenge-start').onclick = () => dispatch({ type: 'challenge', value: 'hold' });
  $('next-challenge').onclick = () => dispatch({ type: 'challenge', value: 'write' });
  $('free').onclick = () => dispatch({ type: 'free' });
  for (const button of notes.querySelectorAll('[data-panel]'))
    button.onclick = () => dispatch({ type: 'panel', value: button.dataset.panel });
  for (const button of notes.querySelectorAll('[data-close-panel]'))
    button.onclick = () => dispatch({ type: 'panel', value: '' });
  const closePanel = (event) => {
    if (event.key === 'Escape' && story.requested.values.panel) {
      event.preventDefault();
      dispatch({ type: 'panel', value: '' });
    }
  };
  root.addEventListener('keydown', closePanel);
  shell.onDispose(() => root.removeEventListener('keydown', closePanel));
  async function restore(snapshot) {
    const checkpoint = snapshot?.privateContent;
    if (checkpoint?.subject?.kind !== 'memory-register') return;
    try {
      await root.scene.restore(checkpoint);
    } catch (error) {
      shell.status.textContent = error.message;
    }
  }
  const saved = widgetState('memory-eight-bits', restore);
  function persist() {
    saved.save({ privateContent: root.scene.capture() });
  }
  await restore(saved.read());
  shell.onDispose(() => {
    saved.dispose();
    prediction.dispose();
    drawing.dispose();
    loop.dispose();
  });
  root.scene.extend({
    snapshot: () =>
      story.presented && {
        ...story.presented.values,
        inputBinary: binary(story.presented.values.input),
        savedBinary: binary(story.presented.values.saved),
      },
  });
})();
