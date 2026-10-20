import { PRESETS } from '../model.js';
import { gptInputs } from '../subject-model.js';

/** The phrase is edited over its tokens; the scene still owns accepted inputs and history. */
export function promptEditor(shell, current) {
  const form = document.createElement('form');
  form.className = 'gpt-prompt-editor ve-notebook-controls';
  form.hidden = true;
  form.setAttribute('aria-label', 'Изменить фразу');
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 200;
  input.setAttribute('aria-label', 'Фраза');
  input.autocomplete = 'off';
  const field = document.createElement('div');
  field.className = 've-control';
  const line = document.createElement('span');
  line.className = 've-field';
  line.append(input);
  field.append(line);
  const actions = document.createElement('div');
  actions.className = 'gpt-prompt-actions';
  const done = document.createElement('button');
  done.type = 'submit';
  done.textContent = 'Готово';
  const example = document.createElement('button');
  example.type = 'button';
  example.textContent = 'Другой пример';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Отмена';
  actions.append(done, example, cancel);
  const error = document.createElement('p');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  form.append(field, actions, error);
  shell.stage.append(form);
  const abort = new AbortController(),
    listen = { signal: abort.signal };
  let opener,
    preset = 0;
  const close = () => {
    form.hidden = true;
    error.hidden = true;
    const target = opener?.isConnected
      ? opener
      : shell.stage.querySelector('[data-action="edit-prompt"]');
    target?.focus({ preventScroll: true });
  };
  const layout = () => {
    const { width, height, scale } = shell.layout;
    form.style.setProperty('--ve-control-unit', `${1 / Math.max(scale, 0.1)}px`);
    form.style.left = '32px';
    form.style.width = `${Math.min(width - 64, 600 / Math.max(scale, 0.1))}px`;
    form.style.maxHeight = `${height - 48}px`;
    form.style.top = `${Math.max(24, Math.min(105, height - form.offsetHeight - 24))}px`;
  };
  form.addEventListener(
    'submit',
    (event) => {
      event.preventDefault();
      try {
        const prompt = input.value.trim();
        gptInputs({ ...current().values, prompt, generated: false });
        shell.input({ prompt });
        close();
      } catch (cause) {
        const token = typeof cause.token === 'string' ? cause.token : '';
        error.textContent =
          cause.code === 'unknown_token'
            ? `Неизвестное слово: ${token.length > 20 ? token.slice(0, 20) + '…' : token}`
            : cause.message;
        error.hidden = false;
        layout();
        input.setAttribute('aria-invalid', 'true');
        input.focus({ preventScroll: true });
      }
    },
    listen,
  );
  form.addEventListener(
    'keydown',
    (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    },
    listen,
  );
  cancel.addEventListener('click', close, listen);
  example.addEventListener(
    'click',
    () => {
      preset = (preset + 1) % PRESETS.length;
      input.value = PRESETS[preset].tokens.join(' ');
      error.hidden = true;
      input.removeAttribute('aria-invalid');
      input.focus({ preventScroll: true });
    },
    listen,
  );
  return {
    layout,
    open() {
      shell.playback?.pause();
      opener = document.activeElement;
      preset = Math.max(
        0,
        PRESETS.findIndex((p) => p.id === current().values.preset),
      );
      input.value = current().trace.tokens.slice(1).join(' ');
      input.removeAttribute('aria-invalid');
      error.hidden = true;
      form.hidden = false;
      layout();
      input.focus({ preventScroll: true });
      input.select();
    },
    dispose() {
      abort.abort();
      form.remove();
    },
  };
}
