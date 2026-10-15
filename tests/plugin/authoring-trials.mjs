import { randomInt, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const sameInputs = (state, inputs) =>
  Boolean(state && Object.entries(inputs).every(([k, v]) => state[k] === v));
const fraction = (value) => value?.numerator / value?.denominator;
const near = (a, b) => Number.isFinite(a) && Math.abs(a - b) < 1e-10;
function timingSummary(reports) {
  const metric = (key, limit) => {
    const values = reports
      .map((report) => (Number.isFinite(report[key]) && report[key] >= 0 ? report[key] : Infinity))
      .sort((a, b) => a - b);
    const percentile = (p) => {
      const value = values[Math.max(0, Math.ceil(values.length * p) - 1)];
      return Number.isFinite(value) ? value : null;
    };
    const p95Ms = percentile(0.95);
    return {
      p50Ms: percentile(0.5),
      p95Ms,
      unobserved: values.filter((value) => !Number.isFinite(value)).length,
      p95WithinLimit: p95Ms !== null && p95Ms <= limit,
    };
  };
  return {
    count: reports.length,
    firstContent: metric('firstUsefulPixelMs', 5000),
    finished: metric('checkedExperienceMs', 20000),
    incorrectStates: reports.filter((report) => !report.computedStateCorrect).length,
    invalidEvidence: reports.filter((report) => !report.evidenceValid).length,
    callErrors: reports.reduce((sum, report) => sum + report.callErrors, 0),
  };
}
const moduleFor = (family) =>
  ({
    division: ['division'],
    lever: ['lever', 'lever-comparison'],
    probability: ['probability'],
    fractions: ['fractions'],
    circuit: ['circuit'],
    sampling: ['sampling'],
    route: ['dependency-route'],
  })[family];
const sourceMatches = (authored, task) =>
  moduleFor(task.family).includes(authored?.models?.[0]?.module) &&
  sameInputs(authored.models[0].inputs, task.inputs);
function intervalMatches(value, successes, count) {
  const z2 = 1.959963984540054 ** 2,
    p = successes / count,
    d = 1 + z2 / count;
  const center = (p + z2 / (2 * count)) / d,
    radius = Math.sqrt(z2 * ((p * (1 - p)) / count + z2 / (4 * count * count))) / d;
  return (
    near(value?.low, Math.max(0, center - radius)) &&
    near(value?.high, Math.min(1, center + radius))
  );
}

// Tasks specify questions and conditions, never a document, prepared answer or tool call.
function taskCase(index) {
  const family =
    index < 18
      ? ['division', 'lever', 'probability'][index % 3]
      : ['fractions', 'circuit', 'sampling', 'route'][(index - 18) % 4];
  if (family === 'division') {
    const count = [11, 13, 17, 19, 23, 29][Math.floor(index / 3)],
      divisor = [4, 5][randomInt(2)],
      next = count + divisor - (count % divisor);
    const inputs = { count, divisor };
    return {
      family,
      domain: 'arithmetic',
      inputs,
      task: `${count} предметов раскладываем по ${divisor}. Покажи, откуда возникает остаток. Затем вручную добавь наименьшее число предметов, чтобы все группы стали полными.`,
      check: (a, b) =>
        sameInputs(a, inputs) &&
        a.quotient === Math.floor(count / divisor) &&
        a.remainder === count % divisor &&
        sameInputs(b, { count: next, divisor }) &&
        b.quotient === next / divisor &&
        b.remainder === 0,
    };
  }
  if (family === 'lever') {
    const leftForce = [4, 6, 8][randomInt(3)],
      leftArm = [30, 40][randomInt(2)],
      rightForce = 4,
      rightArm = 10,
      inputs = { leftForce, leftArm, rightForce, rightArm },
      balancedForce = (leftForce * leftArm) / rightArm;
    const lever = (s, side) => s?.comparison?.[side]?.state ?? s;
    const conditions = (s, side) => s?.comparison?.[side]?.inputs ?? s;
    return {
      family,
      domain: 'mechanics',
      inputs,
      task: `Невесомый горизонтальный рычаг: слева ${leftForce}Н на плече ${leftArm}см, справа ${rightForce}Н на плече ${rightArm}см. Покажи причину вращения. Затем измени только правую силу и найди равновесие. Укажи, что это статическая модель.`,
      check: (a, b) =>
        sameInputs(conditions(a, 'before'), inputs) &&
        !lever(a, 'before')?.equilibrium &&
        sameInputs(conditions(b, 'after'), { ...inputs, rightForce: balancedForce }) &&
        lever(b, 'after')?.equilibrium === true &&
        fraction(lever(b, 'after').netMoment) === 0,
    };
  }
  if (family === 'probability') {
    const scores = [-randomInt(1, 4), 0, randomInt(1, 4)],
      inputs = { scoreA: scores[0], scoreB: scores[1], scoreC: scores[2], temperature: 1 };
    const valid = (s, temp) => {
      const weights = scores.map((x) => Math.exp((x - Math.max(...scores)) / temp)),
        sum = weights.reduce((a, b) => a + b);
      return (
        sameInputs(s, { ...inputs, temperature: temp }) &&
        weights.every((w, i) => near(s.trace?.probabilities[i], w / sum))
      );
    };
    return {
      family,
      domain: 'normalization',
      inputs,
      task: `Учебные оценки А/Б/В равны ${scores.join('/')}, температура1. Покажи превращение оценок в распределение softmax. Затем вручную увеличь температуру до2 и проверь, как изменилась доля лидера. Не выдавай эти доли за достоверность утверждений.`,
      check: (a, b) =>
        valid(a, 1) && valid(b, 2) && b.trace.probabilities[2] < a.trace.probabilities[2],
    };
  }
  if (family === 'fractions') {
    const inputs = {
        leftNumerator: 1,
        leftDenominator: [2, 3, 4][Math.floor((index - 18) / 4)],
        rightNumerator: 1,
        rightDenominator: 6,
        action: 'move',
      },
      sum = 1 / inputs.leftDenominator + 1 / 6;
    return {
      family,
      domain: 'quantity-conservation',
      inputs,
      task: `Соедини 1/${inputs.leftDenominator} и 1/6 одного и того же целого. Пусть движение частей объясняет сумму. Затем вручную убери первую долю, сохранив вторую, и проверь результат.`,
      check: (a, b) =>
        sameInputs(a, inputs) &&
        near(fraction(a.result), sum) &&
        sameInputs(b, { ...inputs, leftNumerator: 0 }) &&
        near(fraction(b.result), 1 / 6),
    };
  }
  if (family === 'circuit') {
    const object = ['фонарик', 'настольная лампа', 'лампа учебного стенда'][
      Math.floor((index - 18) / 4)
    ];
    return {
      family,
      domain: 'electric-circuits',
      inputs: { closed: false },
      task: `${object}: идеальная цепь с батареей, ключом и нагрузкой. Вначале ключ открыт. Коротко покажи замыкание, затем вручную разомкни цепь. Покажи зависимость работы нагрузки от целого контура, без объяснения мгновенной скорости электронов.`,
      check: (a, b) => a?.closed === true && b?.closed === false,
    };
  }
  if (family === 'sampling') {
    const inputs = {
      percent: [30, 50, 70][Math.floor((index - 18) / 4)],
      count: 20,
      seed: randomInt(1, 100000),
    };
    const valid = (s, count) =>
      sameInputs(s, { ...inputs, count }) &&
      s.sample?.count === count &&
      s.sample.draws.length === count &&
      s.sample.successes === s.sample.draws.filter((d) => d.value < inputs.percent / 100).length &&
      s.presented?.count === count &&
      intervalMatches(s.sample.interval, s.sample.successes, count) &&
      intervalMatches(s.presented.interval, s.sample.successes, count);
    return {
      family,
      domain: 'statistical-inference',
      inputs,
      task: `Учебная синтетическая выборка: p=${inputs.percent}%,20 независимых испытаний,seed${inputs.seed}. Покажи, почему наблюдаемая доля отличается от заданной p. Затем вручную увеличь n до40 при том же seed. Объясни смысл95% интервала без утверждения вероятности для уже фиксированной p.`,
      check: (a, b) =>
        valid(a, 20) &&
        valid(b, 40) &&
        a.sample.draws.every((d, i) => d.value === b.sample.draws[i].value),
    };
  }
  const inputs = {
    orderId: String(randomInt(500, 1000)),
    reserve: 'shared',
    'disabled-provider': true,
  };
  return {
    family,
    domain: 'network-dependencies',
    inputs,
    task: `Заказ${inputs.orderId}: провайдерА недоступен, резерв разделяет с ним провайдера. Покажи, почему повторный путь сохраняет отказ. Затем вручную выбери независимый резерв и проверь доставку. Банк работает; сохрани тот же ID заказа.`,
    check: (a, b, presented) =>
      sameInputs(presented.initial, inputs) &&
      a.orderId === inputs.orderId &&
      a.status === 'blocked' &&
      a.blocked === 'provider' &&
      sameInputs(presented.changed, { ...inputs, reserve: 'independent' }) &&
      b.orderId === inputs.orderId &&
      b.status === 'delivered' &&
      b.route.includes('independent') &&
      b.route.at(-1) === 'bank',
  };
}

/** Only measurement and checks. The independent agent authors through ordinary installed MCP tools. */
export function authoringTrials(output, { release, model, reasoning, hardware }) {
  const reports = [];
  let active,
    claim,
    starting = false,
    finishing = false;
  return {
    async start({ context }, client) {
      if (starting || finishing) throw Error('A trial transition is already pending.');
      starting = true;
      try {
        claim ??= writeFile(
          join(output, 'dataset.json'),
          JSON.stringify({ criteriaVersion: 2, release, model, reasoning, hardware }),
          { flag: 'wx' },
        );
        await claim;
        if (active)
          throw Error('Finish the active trial; errors and slow attempts cannot be dropped.');
        if (reports.length >= 30) throw Error('The required dataset is complete.');
        const observed = await client.callTool({
          name: 'story_inspect',
          arguments: { context, detail: 'model' },
        });
        if (observed.isError || observed.structuredContent.status !== 'connected')
          throw Error('Warm card is not connected.');
        const specification = taskCase(reports.length),
          id = randomUUID(),
          start = Date.now();
        active = { id, index: reports.length, start, specification, calls: [] };
        const brief = {
          trialId: id,
          index: active.index,
          family: specification.family,
          domain: specification.domain,
          start,
          task: specification.task,
          context: observed.structuredContent.context,
        };
        await writeFile(join(output, `task-${active.index}.json`), JSON.stringify(brief, null, 2), {
          flag: 'wx',
        });
        return brief;
      } finally {
        starting = false;
      }
    },
    record(request, result, start) {
      if (active) active.calls.push({ ...request, result, start, end: Date.now() });
    },
    assertFirst(authored) {
      if (!active || !sourceMatches(authored, active.specification))
        throw Error("The first drawing must show this task's authored conditions.");
    },
    async finish({ capturedAt, interactionAt, observations, authored, comments, error }) {
      if (finishing || starting) throw Error('A trial transition is already pending.');
      finishing = true;
      try {
        if (!active) throw Error('No active trial.');
        const s = active.specification,
          initial = observations?.initial,
          changed = observations?.changed;
        const states = active.calls
          .map((c) => c.result.structuredContent?.state)
          .filter((state) => state?.snapshot);
        const snapshots = states.map((state) => state.snapshot);
        const presented = Object.fromEntries(
          [
            ['initial', initial],
            ['changed', changed],
          ].map(([label, snapshot]) => [
            label,
            states.findLast((state) => isDeepStrictEqual(state.snapshot, snapshot))?.rendering
              ?.presented?.values,
          ]),
        );
        const observedByMCP = [initial, changed].every(
          (value) => value && snapshots.some((snapshot) => isDeepStrictEqual(value, snapshot)),
        );
        const manual = active.calls.some(
          (c) =>
            c.name === 'story_control' &&
            c.arguments.commands?.some((command) => command.type === 'parameters') &&
            !c.result.isError,
        );
        let computedStateCorrect = false,
          checkError;
        try {
          computedStateCorrect = sourceMatches(authored, s) && s.check(initial, changed, presented);
        } catch (failure) {
          checkError = failure.message;
        }
        const finished = Date.now();
        const narrativeDeclared =
          (authored?.chapters?.flatMap((chapter) => chapter.beats).length ?? 0) >= 2;
        const evidenceValid =
          !error &&
          !checkError &&
          observedByMCP &&
          manual &&
          Number.isFinite(capturedAt) &&
          Number.isFinite(interactionAt) &&
          capturedAt >= active.start &&
          interactionAt >= capturedAt &&
          interactionAt <= finished;
        const firstUsefulPixelMs = Number.isFinite(capturedAt) ? capturedAt - active.start : null,
          checkedExperienceMs = finished - active.start;
        const { specification, ...record } = active;
        const report = {
          ...record,
          criteriaVersion: 2,
          release,
          model,
          reasoning,
          hardware,
          family: s.family,
          domain: s.domain,
          task: s.task,
          finished,
          firstUsefulPixelMs,
          interactionMs: interactionAt - active.start,
          checkedExperienceMs,
          observations,
          authored,
          comments,
          error,
          checkError,
          computedStateCorrect,
          narrativeDeclared,
          evidenceValid,
          observedByMCP,
          callErrors: active.calls.filter((c) => c.result.isError).length,
          timingPassed:
            computedStateCorrect &&
            narrativeDeclared &&
            evidenceValid &&
            firstUsefulPixelMs <= 5000 &&
            checkedExperienceMs <= 20000,
        };
        await writeFile(
          join(output, `trial-${active.index}.json`),
          JSON.stringify(report, null, 2),
          {
            flag: 'wx',
          },
        );
        reports.push(report);
        active = undefined;
        await writeFile(
          join(output, 'summary.json'),
          JSON.stringify(
            {
              release,
              model,
              reasoning,
              hardware,
              required: 30,
              complete: reports.length === 30,
              metrics: {
                all: timingSummary(reports),
                base: timingSummary(reports.filter((report) => report.index < 18)),
                unfamiliar: timingSummary(reports.filter((report) => report.index >= 18)),
                domains: Object.fromEntries(
                  [...new Set(reports.map((report) => report.domain))].map((domain) => [
                    domain,
                    timingSummary(reports.filter((report) => report.domain === domain)),
                  ]),
                ),
              },
              trials: reports.map(({ calls, authored, observations, ...r }) => r),
            },
            null,
            2,
          ),
        );
        return {
          index: report.index,
          firstUsefulPixelMs,
          checkedExperienceMs,
          computedStateCorrect,
          narrativeDeclared,
          evidenceValid,
          timingPassed: report.timingPassed,
          completed: reports.length,
        };
      } finally {
        finishing = false;
      }
    },
  };
}
