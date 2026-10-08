export const bits = [7, 6, 5, 4, 3, 2, 1, 0];
export const binary = (value) => value.toString(2).padStart(8, '0');
export const bit = (value, index) => (value >>> index) & 1;
export const initial = () => ({
  input: 0,
  saved: 0,
  we: false,
  clock: false,
  selected: 5,
  panel: '',
  event: 'reset',
  challenge: '',
  guess: null,
  checked: false,
  trace: [],
});

const byte = (value) => Number.isInteger(value) && value >= 0 && value <= 255;
const boolean = (value) => typeof value === 'boolean';
/** Widget persistence, reopening and current exports share the same input schema. */
export const memoryCheckpoint = {
  encode: (state) => ({ kind: 'memory-register', version: 1, state }),
  decode(value) {
    const state = value?.state;
    if (
      value?.kind !== 'memory-register' ||
      value.version !== 1 ||
      !state ||
      !byte(state.input) ||
      !byte(state.saved) ||
      ![state.we, state.clock, state.checked].every(boolean) ||
      !Number.isInteger(state.selected) ||
      state.selected < 0 ||
      state.selected > 7 ||
      !['reset', 'input', 'enable', 'write', 'blocked', 'fall', 'challenge', 'guess'].includes(
        state.event,
      ) ||
      !['', 'hold', 'write'].includes(state.challenge) ||
      !['', 'inside', 'trace-panel'].includes(state.panel) ||
      !(state.guess === null || byte(state.guess)) ||
      !Array.isArray(state.trace) ||
      state.trace.length > 5 ||
      state.trace.some(
        (item) =>
          !item ||
          !byte(item.input) ||
          !byte(item.saved) ||
          !boolean(item.we) ||
          !boolean(item.write) ||
          !['↑', '↓'].includes(item.edge),
      )
    )
      throw new Error('Сохранённое состояние регистра несовместимо с этой сценой.');
    return structuredClone(state);
  },
};

/** One state transition owns input, the positive clock edge, and the retained byte. */
export function act(state, action) {
  const next = { ...state };
  if (action.type === 'input') {
    next.input = action.value & 255;
    next.event = 'input';
  }
  if (action.type === 'bit') {
    next.input ^= 1 << action.index;
    next.selected = action.index;
    next.event = 'input';
  }
  if (action.type === 'select') next.selected = action.index;
  if (action.type === 'panel') {
    if (!['', 'inside', 'trace-panel'].includes(action.value))
      throw new Error('Неизвестная деталь регистра.');
    next.panel = action.value;
    if (Number.isInteger(action.index) && action.index >= 0 && action.index <= 7)
      next.selected = action.index;
  }
  if (action.type === 'enable') {
    next.we = !state.we;
    next.event = 'enable';
  }
  if (action.type === 'clock') {
    next.clock = !state.clock;
    const rising = !state.clock && next.clock;
    const writing = rising && state.we;
    if (writing) next.saved = state.input;
    next.event = writing ? 'write' : rising ? 'blocked' : 'fall';
    next.trace = [
      ...state.trace,
      {
        input: state.input,
        saved: next.saved,
        we: state.we,
        edge: rising ? '↑' : '↓',
        write: writing,
      },
    ].slice(-5);
    if (state.challenge && rising) next.checked = true;
  }
  if (action.type === 'challenge')
    return {
      ...initial(),
      input: 165,
      saved: 42,
      we: action.value === 'write',
      challenge: action.value,
      event: 'challenge',
    };
  if (action.type === 'guess') {
    next.guess = action.value;
    next.event = 'guess';
  }
  if (action.type === 'free') {
    next.challenge = '';
    next.guess = null;
    next.checked = false;
  }
  if (action.type === 'reset') return initial();
  return next;
}

export function storyState(frame) {
  let s = initial();
  if (frame.has('set_42')) s = act(s, { type: 'input', value: 42 });
  if (frame.has('enable_write')) s = act(s, { type: 'enable' });
  if (frame.has('write_42')) s = act(s, { type: 'clock' });
  if (frame.has('set_165')) s = act(s, { type: 'input', value: 165 });
  if (frame.has('disable_write')) {
    s = act(s, { type: 'enable' });
    s = act(s, { type: 'clock' });
  }
  if (frame.has('blocked_clock')) s = act(s, { type: 'clock' });
  return s;
}
export function explanation(s) {
  if (s.event === 'challenge' || s.event === 'guess')
    return 'Сначала сделай прогноз, затем проверь его фронтом такта.';
  if (s.event === 'write') return `Фронт ↑ + WE = 1 → все 8 бит записаны. Теперь Q = ${s.saved}.`;
  if (s.event === 'blocked') return `Фронт ↑ пришёл, но WE = 0. Память удерживает ${s.saved}.`;
  if (s.event === 'fall') return `Такт упал в 0. На спаде память не записывается: Q = ${s.saved}.`;
  if (s.event === 'input')
    return `Вход D = ${s.input}. В памяти Q = ${s.saved}: изменение входа само по себе ничего не записывает.`;
  if (s.event === 'enable')
    return s.we
      ? 'Запись разрешена. Для переноса данных нужен фронт такта 0 → 1.'
      : 'Запись запрещена. Новый фронт такта сохранит прежний байт.';
  return 'В начале примера память очищена. Нажимай на входные биты, затем управляй записью и тактом.';
}
