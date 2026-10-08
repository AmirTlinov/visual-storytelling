import { SceneShell, widgetState } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';
import './subject.css';
import timing from './timeline.json' with { type: 'json' };
import { binary, bit, act, storyState, explanation, initial } from './memory.js';
import { registerDrawing, feedbackDrawing } from './drawing.js';

window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.querySelector('#ve-scene');
  // One notebook sheet contains the heading, drawing, notes and bottom transport.
  const shell = SceneShell.mount(root, {
    title: 'Как 8 бит запоминают число',
    frame: { width: 1280, height: 720, scope: 'scene' },
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
    '<section id="challenge" class="memory-challenge" hidden aria-label="Опыт с прогнозом"><p id="question"></p>',
    '<div class="guesses" role="group" aria-label="Ваш прогноз">',
    ...[42, 165, 0].map(
      (v) => '<button type="button" data-guess="' + v + '" aria-pressed="false">' + v + '</button>',
    ),
    '</div><p id="feedback" aria-live="polite"></p><div class="memory-actions">',
    '<button id="verify" type="button">Проверить фронтом ↑</button><button id="next-challenge" type="button" hidden>Разрешим запись</button><button id="free" type="button">К опыту</button>',
    '</div></section>',
    '<section class="memory-panel memory-detail" id="inside" hidden tabindex="-1" aria-labelledby="inside-title"><div class="memory-panel-heading"><h2 id="inside-title">Почему один бит удерживает значение?</h2><button type="button" data-close-panel>К схеме</button></div><p id="detail-bit"></p><div id="feedback-drawing"></div><p id="loop-explanation"></p>',
    '<p>Это сердце запоминающего элемента. Управляемые входы D-триггера позволяют переключить его по фронту такта. Регистр удерживает данные, пока есть питание.</p></section>',
    '<section class="memory-panel" id="trace-panel" hidden tabindex="-1" aria-labelledby="trace-title"><div class="memory-panel-heading"><h2 id="trace-title">Последние переключения такта</h2><button type="button" data-close-panel>К схеме</button></div><table class="memory-trace"><thead><tr><th>Такт</th><th>WE</th><th>Вход D</th><th>Память Q</th></tr></thead><tbody id="trace"></tbody></table></section>',
  ].join('');
  const $ = (id) => root.querySelector('#' + id);
  let activePanel = null,
    panelOpener = null;
  function showPanel(id = null, focus = true) {
    if (id === activePanel) return;
    if (id && !activePanel) panelOpener = document.activeElement;
    activePanel = id;
    drawingHost.style.visibility = id ? 'hidden' : '';
    drawingHost.inert = Boolean(id);
    shell.stage.dataset.panel = id ?? 'register';
    for (const panel of notes.querySelectorAll('.memory-panel')) panel.hidden = panel.id !== id;
    $('challenge').hidden = Boolean(id) || !story.values.challenge;
    if (focus) {
      if (id) $(id).focus({ preventScroll: true });
      else panelOpener?.focus({ preventScroll: true });
    }
  }
  const drawing = registerDrawing(drawingHost, dispatch, (index) => {
    dispatch({ type: 'select', index });
    showPanel('inside');
  });
  shell.stage.append(notes);
  const loop = feedbackDrawing($('feedback-drawing'));
  const presets = [...root.querySelectorAll('[data-value]')];
  const guesses = [...root.querySelectorAll('[data-guess]')];
  let lastNotice = '',
    lastTrace = '';
  const story = shell.attachStory({
    audio: root.querySelector('[data-audio]'),
    script: timing,
    stateAt: storyState,
    render(s, frame, mode) {
      if (mode === 'story') showPanel(null, false);
      drawing.render(s, frame, mode);
      notes.hidden = mode === 'story' && !frame.has('your_turn');
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
      $('challenge').hidden = !quiz || Boolean(activePanel);
      $('question').textContent = 'После фронта ↑ в памяти будет…';
      guesses.forEach((button) => {
        button.setAttribute('aria-pressed', String(Number(button.dataset.guess) === s.guess));
        button.disabled = s.checked;
      });
      $('verify').disabled = s.guess === null || s.checked;
      $('verify').hidden = s.checked;
      $('next-challenge').hidden = !s.checked || s.challenge === 'write';
      $('feedback').textContent = s.checked
        ? (s.guess === s.saved ? 'Верно. ' : 'Получилось ' + s.saved + '. ') +
          (s.we ? 'WE = 1 и фронт ↑ записали байт.' : 'WE = 0 сохранил прежний байт.')
        : s.guess === null
          ? 'Сначала выбери свой прогноз.'
          : 'Прогноз ' + s.guess + ' записан. Проверь его тактом.';
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
    story.explore(act(story.values, action));
    persist();
  }
  presets.forEach(
    (button) =>
      (button.onclick = () => dispatch({ type: 'input', value: Number(button.dataset.value) })),
  );
  guesses.forEach(
    (button) =>
      (button.onclick = () => dispatch({ type: 'guess', value: Number(button.dataset.guess) })),
  );
  $('reset').onclick = () => dispatch({ type: 'reset' });
  $('challenge-start').onclick = () => {
    showPanel(null, false);
    dispatch({ type: 'challenge', value: 'hold' });
  };
  $('verify').onclick = () => dispatch({ type: 'clock' });
  $('next-challenge').onclick = () => dispatch({ type: 'challenge', value: 'write' });
  $('free').onclick = () => dispatch({ type: 'free' });
  for (const button of notes.querySelectorAll('[data-panel]'))
    button.onclick = () => {
      story.explore(story.values);
      showPanel(button.dataset.panel);
    };
  for (const button of notes.querySelectorAll('[data-close-panel]'))
    button.onclick = () => showPanel();
  const closePanel = (event) => {
    if (event.key === 'Escape' && activePanel) {
      event.preventDefault();
      showPanel();
    }
  };
  root.addEventListener('keydown', closePanel);
  shell.onDispose(() => root.removeEventListener('keydown', closePanel));
  function restore(snapshot) {
    const s = snapshot?.privateContent;
    if (
      s?.version !== 1 ||
      !s.state ||
      ![s.state.input, s.state.saved].every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
    )
      return;
    const value = { ...initial(), ...s.state };
    if (!Array.isArray(value.trace)) value.trace = [];
    story.seek(Math.min(story.duration, Math.max(0, s.time || 0)));
    story.explore(value);
  }
  const saved = widgetState('memory-eight-bits', restore);
  function persist() {
    saved.save({ privateContent: { version: 1, time: story.currentTime, state: story.values } });
  }
  restore(saved.read());
  shell.onDispose(() => {
    saved.dispose();
    drawing.dispose();
    loop.dispose();
  });
  root.scene.extend({
    snapshot: () => ({
      ...story.values,
      inputBinary: binary(story.values.input),
      savedBinary: binary(story.values.saved),
    }),
  });
})();
