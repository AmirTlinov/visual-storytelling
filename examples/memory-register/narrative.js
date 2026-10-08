/** Local facts follow the same cues and register state as the drawing. */
export function narrative(state, frame, mode) {
  const note = (text, cue) => ({ text, cue });
  if (mode === 'explore') {
    const memory =
      state.challenge && !state.checked
        ? `Сейчас здесь ${state.saved}. Что изменит фронт?`
        : state.event === 'write'
          ? `Записали все 8 бит. Теперь здесь ${state.saved}.`
          : state.event === 'blocked'
            ? `Здесь ${state.saved}: WE = 0 запретил запись.`
            : state.event === 'fall'
              ? `Осталось ${state.saved}. Спад такта не записывает.`
              : `Здесь хранится ${state.saved}. Ждём разрешение и фронт.`;
    return {
      input: note(
        state.challenge
          ? `На входе ${state.input}. Проверим запись этого байта.`
          : `На входе ${state.input}. Нажми на бит, чтобы изменить его.`,
      ),
      memory: state.challenge ? undefined : note(memory),
      enable: note(state.we ? 'Запись разрешена.' : 'Запись запрещена.'),
      clock: note(state.clock ? 'Такт в 1.\nСначала верни в 0.' : 'Дадим фронт:\n0 → 1.'),
      focus: state.event === 'input' ? 'input' : state.event === 'enable' ? 'enable' : 'memory',
      single: false,
    };
  }

  const result = {
    memory: note('Один бит хранит 0 или 1.'),
    single: !frame.has('eight_cells'),
    focus: 'memory',
  };
  if (frame.has('eight_cells'))
    result.memory = note('Восемь ячеек вместе хранят один байт.', 'eight_cells');
  if (frame.has('byte_range'))
    result.memory = note('Один байт хранит число от 0 до 255.', 'byte_range');
  if (frame.has('set_42')) {
    result.input = note('Выставляем 42. Пока оно только на входе.', 'set_42');
    result.memory = undefined;
    result.focus = 'input';
  }
  if (frame.has('input_hold')) {
    result.memory = note('В памяти по-прежнему 0. Вход не записан.', 'input_hold');
    result.focus = 'memory';
  }
  if (frame.has('enable_write')) {
    result.enable = note('Запись включена.\nЖдём фронт.', 'enable_write');
    result.focus = 'enable';
  }
  if (frame.has('clock_rise')) {
    result.clock = note('Фронт: переход\nиз 0 в 1.', 'clock_rise');
    result.focus = 'clock';
  }
  if (frame.has('write_42')) {
    result.input = note('Эти восемь бит записываются вместе.', 'write_42');
    result.memory = note('Один фронт — весь байт в памяти.', 'write_42');
    result.enable = note('WE = 1 разрешает запись.');
    result.clock = note('Фронт — всем\nвосьми ячейкам.', 'write_42');
    result.focus = 'write';
  }
  if (frame.has('written')) result.memory = note('Теперь здесь 42. Байт запомнен.', 'written');
  if (frame.has('set_165')) {
    result.input = note('Меняем вход: теперь здесь 165.', 'set_165');
    result.memory = note('Здесь осталось 42.');
    result.clock = note('Нового фронта нет:\nтакт уже в 1.');
    result.focus = 'input';
  }
  if (frame.has('held')) {
    result.memory = note('Здесь всё ещё 42: нового фронта не было.', 'held');
    result.focus = 'memory';
  }
  if (frame.has('disable_write')) {
    result.enable = note('Запретим запись: WE = 0.', 'disable_write');
    result.clock = note('Такт снова в 0.\nДадим новый фронт.');
    result.focus = 'enable';
  }
  if (frame.has('blocked_clock')) {
    result.memory = undefined;
    result.clock = note('Фронт есть.\nЗапись запрещена.', 'blocked_clock');
    result.focus = 'clock';
  }
  if (frame.has('blocked_hold')) {
    result.memory = note('42 сохраняется: запись запрещена.', 'blocked_hold');
    result.focus = 'memory';
  }
  if (frame.has('both_conditions')) {
    result.memory = note('Для записи нужны оба условия:', 'both_conditions');
    result.enable = note('1. Разрешение записи.');
    result.clock = note('2. Новый фронт такта.');
    result.focus = 'conditions';
  }
  if (frame.has('your_turn')) {
    result.input = note('Теперь меняй биты сам. Что получится на входе?', 'your_turn');
    result.memory = note('Перед записью предскажи, что окажется здесь.', 'your_turn');
    result.enable = note('Разреши или запрети запись.');
    result.clock = note('Проверь прогноз\nновым фронтом.');
    result.focus = 'input';
  }
  return result;
}
