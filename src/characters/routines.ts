import type { Beat } from './types.js';
import type { Destination, StageAction } from './staging/types.js';

type Step = { action: StageAction; text: string; mood?: Record<string, string> };
const sequence = (id: string, steps: Step[]): Beat[] =>
  steps.map((s, i) => ({
    id: `${id}-${i + 1}`,
    title: s.text,
    text: s.text,
    perform: [s.action],
    actors: s.mood,
  }));
/** Reusable causal sequences. The existing action planner still owns every contact and route. */
export const routines = {
  enter(id: string, actor: string, door = 'door') {
    return sequence(id, [
      { action: { action: 'openDoor', actor, door }, text: 'Открыть дверь' },
      {
        action: { action: 'passDoor', actor, door, to: 'inside' },
        text: 'Переступить порог',
      },
    ]);
  },
  leave(id: string, actor: string, door = 'door', close = true) {
    return sequence(id, [
      {
        action: { action: 'openDoor', actor, door },
        text: 'Открыть дверь для выхода',
      },
      {
        action: { action: 'passDoor', actor, door, to: 'outside' },
        text: 'Выйти во двор',
      },
      ...(close
        ? [
            {
              action: { action: 'closeDoor', actor, door } as StageAction,
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
      { action: { action: 'take', actor, object: book }, text: 'Взять книгу' },
      { action: { action: 'sit', actor, seat }, text: 'Устроиться у света' },
      { action: { action: 'openBook', actor, book }, text: 'Раскрыть книгу' },
      {
        action: { action: 'read', actor, book, pages },
        text: 'Прочитать и перелистать',
        mood: { [actor]: 'think' },
      },
      { action: { action: 'closeBook', actor, book }, text: 'Сохранить мысль' },
      { action: { action: 'stand', actor }, text: 'Встать' },
      { action: { action: 'put', actor, onto: table }, text: 'Вернуть книгу на стол' },
    ]);
  },
  greet(id: string, actors: readonly [string, string], to: Destination = 'near') {
    return sequence(id, [
      {
        action: { action: 'highFive', actors },
        text: 'Дай пять!',
        mood: Object.fromEntries(actors.map((a) => [a, 'excited'])),
      },
      {
        action: { action: 'walkTogether', actors, to },
        text: 'Пойти вместе',
        mood: Object.fromEntries(actors.map((a) => [a, 'idle'])),
      },
    ]);
  },
  stairs(id: string, actor: string, stairs = 'stairs') {
    return sequence(id, [
      { action: { action: 'climb', actor, stairs }, text: 'Подняться на площадку' },
      { action: { action: 'turn', actor, facing: 'front' }, text: 'Оглянуться' },
      { action: { action: 'descend', actor, stairs }, text: 'Спуститься во двор' },
    ]);
  },
};
