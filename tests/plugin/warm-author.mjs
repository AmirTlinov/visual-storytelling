import { randomInt, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Measures the real agent/SDK/browser route. It never authors or controls an experience. */
export function warmAuthorTrial(output) {
  let trial;
  return {
    async start({ context }, client) {
      if (!context) throw Error('Wait for the card’s confirmed model context.');
      const observed = await client.callTool({
        name: 'story_inspect',
        arguments: { context, detail: 'model' },
      });
      if (observed.isError || observed.structuredContent.status !== 'connected')
        throw Error('Warm card is not connected.');
      const count = [11, 13, 19, 23][randomInt(4)],
        divisor = [4, 5][randomInt(2)];
      trial = {
        id: randomUUID(),
        start: Date.now(),
        count,
        divisor,
        next: count + divisor - (count % divisor),
        calls: [],
      };
      return {
        trialId: trial.id,
        start: trial.start,
        count,
        divisor,
        context: observed.structuredContent.context,
        task: `Покажи короткую живую историю: ${count} предметов раскладываем по ${divisor}. Почему остаётся остаток и сколько предметов надо добавить, чтобы получить только полные группы? Покажи это изменение в той же карточке.`,
      };
    },
    record(request, result, start) {
      if (trial)
        trial.calls.push({
          name: request.name,
          arguments: request.arguments,
          result,
          start,
          end: Date.now(),
        });
    },
    async finish({ capturedAt, observations }) {
      if (!trial) throw Error('No active authoring trial.');
      const finished = Date.now();
      const initial = observations.initial,
        changed = observations.changed;
      const correct =
        initial?.count === trial.count &&
        initial.divisor === trial.divisor &&
        initial.quotient === Math.floor(trial.count / trial.divisor) &&
        initial.remainder === trial.count % trial.divisor &&
        changed?.count === trial.next &&
        changed.divisor === trial.divisor &&
        changed.quotient === trial.next / trial.divisor &&
        changed.remainder === 0;
      const snapshots = trial.calls.map(call => call.result.structuredContent?.state?.snapshot).filter(Boolean);
      const observedByMCP = [initial, changed].every(value => value && snapshots.some(snapshot =>
        ['count', 'divisor', 'quotient', 'remainder'].every(key => snapshot[key] === value[key])));
      const report = {
        ...trial,
        finished,
        firstUsefulPixelMs: capturedAt - trial.start,
        checkedExperienceMs: finished - trial.start,
        observations,
        correct,
        observedByMCP,
        passed:
          correct && observedByMCP &&
          capturedAt >= trial.start &&
          capturedAt - trial.start <= 5000 &&
          finished - trial.start <= 20000,
      };
      await writeFile(
        join(output, `warm-author-${trial.id}.json`),
        JSON.stringify(report, null, 2),
      );
      return {
        trialId: trial.id,
        firstUsefulPixelMs: report.firstUsefulPixelMs,
        checkedExperienceMs: report.checkedExperienceMs,
        correct,
        passed: report.passed,
      };
    },
  };
}
