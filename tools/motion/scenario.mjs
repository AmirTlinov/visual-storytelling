const actions = new Set(['click', 'dblclick', 'hover', 'fill', 'press', 'scroll', 'drag', 'wait']);

export function validateScenario(value) {
  if (!value || typeof value !== 'object') throw new Error('Scenario must be a JSON object');
  if (value.theme !== undefined && !['light', 'dark'].includes(value.theme))
    throw new Error('Scenario theme must be light or dark');
  for (const key of ['reduced', 'headed'])
    if (value[key] !== undefined && typeof value[key] !== 'boolean')
      throw new Error(`Scenario ${key} must be boolean`);
  const steps = value.actions ?? [];
  if (!Array.isArray(steps) || steps.length > 40)
    throw new Error('Scenario actions must be an array of at most 40 steps');
  for (const [i, step] of steps.entries()) {
    if (!step || typeof step !== 'object') throw new Error(`Action ${i + 1} must be an object`);
    if (!actions.has(step.type))
      throw new Error(`Action ${i + 1}: choose ${[...actions].join(', ')}`);
    if (!['wait', 'scroll', 'press'].includes(step.type) && !step.selector && !step.role)
      throw new Error(`Action ${i + 1}: selector or role is required`);
    if (step.type === 'wait' && (!Number.isFinite(step.ms) || step.ms < 0 || step.ms > 10000))
      throw new Error(`Action ${i + 1}: wait needs ms between 0 and 10000`);
    if (step.type === 'fill' && typeof step.value !== 'string' && typeof step.env !== 'string')
      throw new Error(
        `Action ${i + 1}: fill needs a string value or an environment variable name in env`,
      );
    if (step.type === 'press' && typeof step.key !== 'string')
      throw new Error(`Action ${i + 1}: press needs a key`);
    if (step.type === 'drag' && typeof step.to !== 'string')
      throw new Error(`Action ${i + 1}: drag needs a destination selector in to`);
    if (step.type === 'scroll' && ![step.x ?? 0, step.y ?? 0].every(Number.isFinite))
      throw new Error(`Action ${i + 1}: scroll needs numeric x/y deltas`);
    if (
      step.repeat !== undefined &&
      (step.type !== 'click' ||
        !Number.isInteger(step.repeat) ||
        step.repeat < 2 ||
        step.repeat > 20 ||
        !Number.isFinite(step.intervalMs) ||
        step.intervalMs < 10 ||
        step.intervalMs > 10000)
    )
      throw new Error(`Action ${i + 1}: repeated click needs repeat 2–20 and intervalMs 10–10000`);
  }
  const seconds = value.seconds ?? 2;
  if (!Number.isFinite(seconds) || seconds < 0.1 || seconds > 15)
    throw new Error('--seconds must be between 0.1 and 15 (time after the last action)');
  const width = value.width ?? 960,
    height = value.height ?? 720;
  if (![width, height].every((v) => Number.isInteger(v) && v >= 240 && v <= 4096))
    throw new Error('Browser width/height must be integers between 240 and 4096');
  const targets = value.targets ?? (value.target ? [value.target] : []);
  if (
    !Array.isArray(targets) ||
    targets.length > 12 ||
    !targets.every((v) => typeof v === 'string')
  )
    throw new Error('Use at most 12 target CSS selectors');
  return {
    ...value,
    actions: steps,
    seconds,
    width,
    height,
    targets,
    theme: value.theme ?? 'light',
    reduced: value.reduced ?? false,
  };
}

export async function runScenario(page, steps, onStep) {
  for (const [index, step] of steps.entries()) {
    const locator = step.role
      ? page.getByRole(step.role, { name: step.name, exact: true })
      : step.selector
        ? page.locator(step.selector)
        : undefined;
    await onStep({ index, ...step, phase: 'start' });
    try {
      switch (step.type) {
        case 'click':
          if (!step.repeat) await locator.click({ timeout: 5000, noWaitAfter: true });
          else {
            await locator.waitFor({ state: 'visible', timeout: 5000 });
            await locator.scrollIntoViewIfNeeded({ timeout: 5000 });
            const box = await locator.boundingBox();
            if (!box) throw new Error('Repeated click target has no visible box');
            const started = performance.now();
            // Repeated input at one pointer location; readiness checks run once.
            for (let n = 0; n < step.repeat; n++) {
              const delay = started + n * step.intervalMs - performance.now();
              if (delay > 0) await new Promise((done) => setTimeout(done, delay));
              await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            }
          }
          break;
        case 'dblclick':
          await locator.dblclick({ timeout: 5000, noWaitAfter: true });
          break;
        case 'hover':
          await locator.hover({ timeout: 5000 });
          break;
        case 'fill':
          await locator.fill(
            step.env
              ? (process.env[step.env] ??
                  (() => {
                    throw new Error(`Environment variable ${step.env} is missing`);
                  })())
              : step.value,
            { timeout: 5000 },
          );
          break;
        case 'press':
          await (locator ?? page.keyboard).press(step.key, { timeout: 5000 });
          break;
        case 'scroll':
          if (locator) await locator.hover({ timeout: 5000 });
          await page.mouse.wheel(step.x ?? 0, step.y ?? 0);
          break;
        case 'drag':
          await locator.dragTo(page.locator(step.to), { timeout: 5000 });
          break;
        case 'wait':
          await page.waitForTimeout(step.ms);
          break;
      }
      await onStep({ index, ...step, phase: 'end' });
    } catch (error) {
      throw new Error(
        `Action ${index + 1} (${step.type} ${step.selector ?? step.name ?? ''}): ${error.message}`,
      );
    }
  }
}
