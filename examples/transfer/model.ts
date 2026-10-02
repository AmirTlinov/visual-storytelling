export const input = [3, 5, 7, 9] as const;
export const output = input.map((value) => value * 2);
const empty = ['—', '—', '—', '—'];
export const phases = [
  ['Подготовка', 'CPU готовит четыре числа: 3, 5, 7, 9.'],
  ['Запись CPU', 'CPU записывает числа в общий буфер памяти.'],
  ['Задание GPU', 'CPU поручает GPU удвоить каждый элемент.'],
  ['Чтение GPU', 'GPU читает четыре числа из общего буфера.'],
  ['Вычисление', 'Четыре потока GPU умножают свои числа на два.'],
  ['Запись GPU', 'GPU записывает результат в тот же буфер.'],
  ['Завершение', 'GPU завершил работу — CPU может читать результат.'],
  ['Чтение CPU', 'CPU читает результат: 6, 10, 14, 18.'],
] as const;
/** Values change on arrival, including when seeking backwards through a transfer. */
export function memoryAt(time: number) {
  const bounded = Math.min(24, Math.max(0, time));
  const step = Math.min(7, Math.floor(bounded / 3));
  const progress = Math.max(0, Math.min(1, (bounded - step * 3 - 0.6) / 1.6));
  const arrived = (at: number) => step > at || (step === at && progress === 1);
  return {
    time: bounded,
    step,
    progress,
    cpu: arrived(7) ? output : input,
    memory: arrived(5) ? output : arrived(1) ? input : empty,
    gpu:
      step > 4
        ? output
        : step === 4
          ? input.map((value, i) => (progress >= (i + 1) / 4 ? value * 2 : value))
          : arrived(3)
            ? input
            : empty,
    completed: arrived(6),
    received: arrived(1),
  };
}
export type MemoryState = ReturnType<typeof memoryAt>;
