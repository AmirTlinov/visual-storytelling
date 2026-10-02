import {
  surface,
  object,
  lettering,
  matrix,
  transfer,
  type Point,
} from '@visual-storytelling/core';
import { input, output, phases, type MemoryState } from './model';

export function drawing(parent: HTMLElement, width: number) {
  const compact = width < 520,
    bodyWidth = Math.min(232, (width - 48) / 2);
  const margin = Math.max(8, (width - 680) / 2),
    cpuX = margin + bodyWidth / 2,
    gpuX = width - cpuX;
  const pitch = Math.min(80, (width - 32) / 4),
    memLeft = width / 2 - pitch * 1.5,
    memRight = width / 2 + pitch * 1.5;
  const view = surface(parent, {
    id: 'transfer',
    width,
    height: 480,
    title: 'Один буфер для CPU и GPU',
    description:
      'Подготовка, запись CPU, задание, чтение GPU, вычисление, запись результата, завершение и чтение CPU.',
  });
  lettering(view.layer, 'Общая память · один буфер', {
    x: width / 2,
    y: 30,
    size: compact ? 22 : 27,
  });
  const memory = matrix(view, 'memory', {
    rows: 1,
    columns: 4,
    cellWidth: pitch,
    cellHeight: 44,
    pigment: 'purple',
    frame: 'cells',
  });
  memory.at(width / 2, 82);
  const registers = (
    [
      ['cpu', cpuX, 'blue'],
      ['gpu', gpuX, 'ochre'],
    ] as const
  ).map(([name, x, pigment]) => {
    const body = object(view.layer, name, pigment);
    body.at(x, 228);
    view.pen.rect(body.content, `${name}:outline`, -bodyWidth / 2, 0, bodyWidth, 122);
    lettering(body.content, name.toUpperCase(), { y: 25, size: 24 });
    const values = matrix(view, `${name}-values`, {
      rows: 1,
      columns: 4,
      cellWidth: (bodyWidth - 14) / 4,
      cellHeight: 40,
      size: compact ? 19 : 24,
      pigment,
      frame: 'cells',
    });
    values.at(x, 290);
    const caption = lettering(body.content, '', { y: 105, size: compact ? 15 : 18 });
    return { body, values, caption };
  });
  const cpu: Point = [cpuX, 226],
    gpu: Point = [gpuX, 226],
    left: Point = [memLeft, 106],
    right: Point = [memRight, 106];
  const paths = {
    cpuUp: `M${cpu.join(' ')} C${cpuX} 164 ${memLeft} 169 ${left.join(' ')}`,
    cpuDown: `M${left.join(' ')} C${memLeft} 169 ${cpuX} 164 ${cpu.join(' ')}`,
    gpuUp: `M${gpu.join(' ')} C${gpuX} 164 ${memRight} 169 ${right.join(' ')}`,
    gpuDown: `M${right.join(' ')} C${memRight} 169 ${gpuX} 164 ${gpu.join(' ')}`,
    dispatch: `M${cpuX} 350 V379 Q${cpuX} 386 ${cpuX + 7} 386 H${gpuX - 7} Q${gpuX} 386 ${gpuX} 379 V350`,
    complete: `M${gpuX} 350 V379 Q${gpuX} 386 ${gpuX - 7} 386 H${cpuX + 7} Q${cpuX} 386 ${cpuX} 379 V350`,
  };
  for (const name of ['cpuUp', 'gpuUp', 'dispatch'] as const)
    view.pen.path(view.layer, `route:${name}`, paths[name], { width: 1.2, pencil: true });
  const cpuRoute = lettering(view.layer, 'данные ↕', {
    x: (cpuX + memLeft) / 2,
    y: 150,
    size: 16,
  });
  const gpuRoute = lettering(view.layer, 'данные ↕', {
    x: (gpuX + memRight) / 2,
    y: 150,
    size: 16,
  });
  const command = lettering(view.layer, 'команды и завершение', {
    x: width / 2,
    y: 416,
    size: compact ? 18 : 21,
  });
  const flows = [
    { step: 1, from: cpu, to: left, path: paths.cpuUp, value: input.join('  '), pigment: 'blue' },
    {
      step: 2,
      from: [cpuX, 350],
      to: [gpuX, 350],
      path: paths.dispatch,
      value: '× 2',
      pigment: 'purple',
    },
    {
      step: 3,
      from: right,
      to: gpu,
      path: paths.gpuDown,
      value: input.join('  '),
      pigment: 'ochre',
    },
    {
      step: 5,
      from: gpu,
      to: right,
      path: paths.gpuUp,
      value: output.join('  '),
      pigment: 'ochre',
    },
    {
      step: 6,
      from: [gpuX, 350],
      to: [cpuX, 350],
      path: paths.complete,
      value: 'готово',
      pigment: 'purple',
    },
    {
      step: 7,
      from: left,
      to: cpu,
      path: paths.cpuDown,
      value: output.join('  '),
      pigment: 'blue',
    },
  ] as const;
  const transfers = flows.map((flow) => ({
    step: flow.step,
    route: transfer(view, `transfer-${flow.step}`, {
      ...flow,
      size: 28,
      width: flow.step === 2 || flow.step === 6 ? 74 : 112,
    }),
  }));
  const stepLabel = lettering(view.layer, '', { x: width / 2, y: 461, size: compact ? 21 : 25 });
  return {
    view,
    dispose: view.dispose,
    render(state: MemoryState, reduced: boolean) {
      memory.set([state.memory]);
      registers[0]!.values.set([state.cpu]);
      registers[1]!.values.set([state.gpu]);
      registers[0]!.caption.text(
        state.step === 0
          ? 'исходные числа'
          : state.step === 7 && state.progress === 1
            ? 'прочитано'
            : state.completed
              ? 'можно читать'
              : 'регистры',
      );
      registers[1]!.caption.text(
        state.step < 2
          ? 'ждёт'
          : state.step === 2
            ? 'задание × 2'
            : state.step === 3
              ? 'чтение'
              : state.step === 4
                ? '× 2 в каждом потоке'
                : state.step === 5
                  ? 'запись'
                  : 'готово',
      );
      cpuRoute.text(state.step === 1 ? 'запись ↑' : state.step === 7 ? 'чтение ↓' : 'данные ↕');
      gpuRoute.text(state.step === 3 ? 'чтение ↓' : state.step === 5 ? 'запись ↑' : 'данные ↕');
      command.text(
        state.step === 2 ? 'задание →' : state.step === 6 ? '← завершение' : 'команды и завершение',
      );
      stepLabel.text(`${state.step + 1}. ${phases[state.step]![0]}`);
      transfers.forEach(({ step, route }) =>
        route.render(step === state.step ? state.progress : 0, reduced),
      );
      view.element.dataset.received = String(state.received);
      view.element.dataset.completed = String(state.completed);
    },
  };
}
