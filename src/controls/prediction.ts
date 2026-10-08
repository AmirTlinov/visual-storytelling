import type { ControlValue } from './fields.js';

export interface PredictionOptions {
  label?: string;
  choices: readonly { value: ControlValue; label: string }[];
  runLabel: string;
  onChoose(value: ControlValue): void;
  onRun(): void;
}
export interface PredictionState {
  question: string;
  guess: ControlValue | null;
  checked: boolean;
  /** The subject model supplies feedback only after its action has run. */
  feedback: string;
}
let serial = 0;

/** Shared accessible presentation; the scene owns the attempt, action and assessment. */
export function predictionPrompt(parent: HTMLElement, options: PredictionOptions) {
  if (
    !options.choices.length ||
    new Set(options.choices.map((choice) => choice.value)).size !== options.choices.length
  )
    throw new Error('A prediction needs distinct choices');
  const abort = new AbortController();
  const element = document.createElement('section');
  element.className = 've-prediction';
  element.setAttribute('aria-label', options.label ?? 'Опыт с прогнозом');
  const question = document.createElement('p');
  question.id = `prediction-${++serial}`;
  const choices = document.createElement('div');
  choices.className = 've-prediction-choices';
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-labelledby', question.id);
  const buttons = options.choices.map((choice) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = choice.label;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => options.onChoose(choice.value), {
      signal: abort.signal,
    });
    choices.append(button);
    return button;
  });
  const feedback = document.createElement('p');
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  feedback.setAttribute('aria-atomic', 'true');
  feedback.tabIndex = -1;
  const run = document.createElement('button');
  run.type = 'button';
  run.textContent = options.runLabel;
  run.disabled = true;
  run.addEventListener('click', () => options.onRun(), { signal: abort.signal });
  element.append(question, choices, feedback, run);
  parent.append(element);
  return {
    element,
    render(state: PredictionState) {
      const focusResult = state.checked && document.activeElement === run;
      question.textContent = state.question;
      const choice = options.choices.find((choice) => choice.value === state.guess);
      buttons.forEach((button, index) => {
        button.setAttribute('aria-pressed', String(options.choices[index]!.value === state.guess));
        button.disabled = state.checked;
      });
      run.disabled = !choice || state.checked;
      run.hidden = state.checked;
      const message = state.checked
        ? state.feedback
        : choice
          ? `Прогноз записан: ${choice.label}. Теперь проверьте его.`
          : 'Сначала выберите свой прогноз.';
      if (feedback.textContent !== message) feedback.textContent = message;
      if (focusResult) feedback.focus({ preventScroll: true });
    },
    dispose() {
      abort.abort();
      element.remove();
    },
  };
}
