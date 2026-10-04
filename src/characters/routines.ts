import type { Beat } from './types.js';
import type { Destination, StageAction } from './staging/types.js';

type Step = { action: StageAction; seconds: number; text: string; mood?: Record<string, string> };
const sequence = (id: string, steps: Step[]): Beat[] =>
  steps.map((s, i) => ({
    id: `${id}-${i + 1}`,
    title: s.text,
    text: s.text,
    seconds: s.seconds,
    perform: [s.action],
    actors: s.mood,
  }));
/** Reusable causal sequences. The existing action planner still owns every contact and route. */
export const routines = {
  enter(id: string, actor: string, door = 'door') {
    return sequence(id, [
      { action: { action: 'openDoor', actor, door }, seconds: 5, text: 'Открыть дверь' },
      {
        action: { action: 'passDoor', actor, door, to: 'inside' },
        seconds: 3,
        text: 'Переступить порог',
      },
    ]);
  },
  leave(id: string, actor: string, door = 'door', close = true) {
    return sequence(id, [
      {
        action: { action: 'passDoor', actor, door, to: 'outside' },
        seconds: 3,
        text: 'Выйти во двор',
      },
      ...(close
        ? [
            {
              action: { action: 'closeDoor', actor, door } as StageAction,
              seconds: 4.5,
              text: 'Закрыть за собой дверь',
            },
          ]
        : []),
    ]);
  },
  read(
    id: string,
    options: { actor: string; book?: string; seat?: string; table?: string; pages?: number },
  ) {
    const { actor, book = 'book', seat = 'seat', table = 'sideTable', pages = 3 } = options;
    return sequence(id, [
      { action: { action: 'take', actor, object: book }, seconds: 4.5, text: 'Взять книгу' },
      { action: { action: 'sit', actor, seat }, seconds: 4, text: 'Устроиться у света' },
      { action: { action: 'openBook', actor, book }, seconds: 1.5, text: 'Раскрыть книгу' },
      {
        action: { action: 'read', actor, book, pages },
        seconds: 2 * pages + 1,
        text: 'Прочитать и перелистать',
        mood: { [actor]: 'think' },
      },
      { action: { action: 'closeBook', actor, book }, seconds: 1.5, text: 'Сохранить мысль' },
      { action: { action: 'stand', actor }, seconds: 1.3, text: 'Встать' },
      { action: { action: 'put', actor, onto: table }, seconds: 4, text: 'Вернуть книгу на стол' },
    ]);
  },
  greet(id: string, actors: readonly [string, string], to: Destination = 'near') {
    return sequence(id, [
      {
        action: { action: 'highFive', actors },
        seconds: 3,
        text: 'Дай пять!',
        mood: Object.fromEntries(actors.map((a) => [a, 'excited'])),
      },
      {
        action: { action: 'walkTogether', actors, to },
        seconds: 5.5,
        text: 'Пойти вместе',
        mood: Object.fromEntries(actors.map((a) => [a, 'idle'])),
      },
    ]);
  },
  stairs(id: string, actor: string, stairs = 'stairs') {
    return sequence(id, [
      { action: { action: 'climb', actor, stairs }, seconds: 5, text: 'Подняться на площадку' },
      { action: { action: 'turn', actor, facing: 'front' }, seconds: 1, text: 'Оглянуться' },
      { action: { action: 'descend', actor, stairs }, seconds: 4, text: 'Спуститься во двор' },
    ]);
  },
};
