import { Physics2D, PhysicsReplay } from '@visual-storytelling/core/physics/2d';
export const experiment = { mass: 2, gravity: 9.81, duration: 3, width: 0.8, height: 1 };
export function validateInputs(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Object.keys(value).sort().join() !== 'angle,friction,push'
  )
    throw Error('block.inputs: provide angle, friction and push.');
  for (const [key, max] of [
    ['angle', 30],
    ['friction', 1],
    ['push', 12],
  ])
    if (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > max)
      throw Error(`block.${key}: expected a value from 0 to ${max}.`);
  return { angle: value.angle, friction: value.friction, push: value.push };
}
const inputsOf = (s) => ({ angle: s.angle, friction: s.friction, push: s.push });
/** The model owns immutable fixed-step recordings and one explicitly sampled Rapier world. */
export async function createBlockExperiment() {
  const world = await Physics2D.create();
  try {
    const material = { friction: 0.55, restitution: 0, damping: 0 };
    const ground = world.body('incline', {
      shape: { box: [100, 0.2] },
      at: [0, 0.1],
      fixed: true,
      material,
    });
    const block = world.body('block', {
      shape: { box: [experiment.width, experiment.height] },
      at: [0, -experiment.height / 2 - 0.003],
      mass: experiment.mass,
      material,
    });
    block.rigid.lockRotations(true, true);
    const initial = world.snapshot(),
      records = new Map();
    let inputs,
      origin = 0,
      settling = false;
    const forceAt = (time) =>
      !settling &&
      Math.round(time / world.stepSeconds) >= 60 &&
      Math.round(time / world.stepSeconds) < 180
        ? (inputs?.push ?? 0)
        : 0;
    world.beforeStep(() => {
      block.rigid.resetForces(false);
      block.rigid.wakeUp();
      block.rigid.addForce({ x: forceAt(world.time - origin), y: 0 }, true);
    });
    const replay = PhysicsReplay.create(world, {
      duration: experiment.duration,
      checkpointEvery: 0.25,
      maxCheckpoints: 16,
    });
    function sample() {
      if (!inputs) throw Error('Select physical conditions before sampling the live world.');
      const time = Math.round((world.time - origin) / world.stepSeconds) * world.stepSeconds;
      let normalImpulse = 0,
        tangentImpulse = 0,
        contacts = 0;
      world.raw.contactPair(ground.rigid.collider(0), block.rigid.collider(0), (m) => {
        for (let i = 0; i < m.numContacts(); i++) {
          normalImpulse += m.contactImpulse(i);
          tangentImpulse += m.contactTangentImpulse(i);
          contacts++;
        }
      });
      return {
        ...inputs,
        id: 'block',
        time,
        position: [...block.position],
        distance: block.position[0],
        velocity: block.rigid.linvel().x,
        contacts,
        forces: {
          weight: experiment.mass * experiment.gravity,
          downhill: experiment.mass * experiment.gravity * Math.sin((inputs.angle * Math.PI) / 180),
          // Observed force and contact impulses refer to the same completed integration step.
          push: time === 0 ? 0 : forceAt(time - world.stepSeconds),
          normal: normalImpulse / world.stepSeconds,
          frictionImpulse: tangentImpulse,
          friction: Math.abs(tangentImpulse) / world.stepSeconds,
        },
        units: { length: 'm', time: 's', mass: 'kg', force: 'N' },
      };
    }
    function recording(value) {
      const next = validateInputs(value),
        key = JSON.stringify(next);
      if (records.has(key)) {
        const found = records.get(key);
        records.delete(key);
        records.set(key, found);
        return found;
      }
      const previous = { snapshot: world.snapshot(), inputs, origin };
      try {
        world.restore(initial);
        inputs = next;
        const angle = (inputs.angle * Math.PI) / 180;
        world.raw.gravity = {
          x: experiment.gravity * Math.sin(angle),
          y: experiment.gravity * Math.cos(angle),
        };
        for (const body of [ground, block]) body.rigid.collider(0).setFriction(inputs.friction);
        settling = true;
        world.step(60);
        settling = false;
        origin = world.time;
        block.rigid.setTranslation({ x: 0, y: block.position[1] }, true);
        block.rigid.setLinvel({ x: 0, y: 0 }, true);
        const baseline = world.snapshot();
        replay.rebase();
        const rows = [];
        for (let step = 0; step <= 360; step++) {
          replay.seek(step * world.stepSeconds);
          const sampled = sample();
          rows.push(
            Object.freeze({
              ...sampled,
              position: Object.freeze(sampled.position),
              forces: Object.freeze(sampled.forces),
              units: Object.freeze(sampled.units),
            }),
          );
        }
        const record = {
          inputs: next,
          baseline,
          rows: Object.freeze(rows),
          trace: Object.freeze(rows.filter((_, i) => i % 6 === 0)),
        };
        records.set(key, record);
        if (records.size > 8) records.delete(records.keys().next().value);
        return record;
      } finally {
        settling = false;
        inputs = previous.inputs;
        origin = previous.origin;
        world.restore(previous.snapshot);
        replay.rebase();
      }
    }
    function atTime(record, time) {
      if (!Number.isFinite(time)) throw Error('Physical time must be finite.');
      const step = Math.round(Math.max(0, Math.min(experiment.duration, time)) / world.stepSeconds);
      return {
        ...record.rows[step],
        trace: record.trace,
        engine: 'Rapier 2D 0.21.0',
        stepSeconds: world.stepSeconds,
      };
    }
    const state = (value, time) => atTime(recording(value), time);
    function seek(value, time) {
      const record = recording(value);
      const selected = atTime(record, time);
      inputs = record.inputs;
      origin = record.baseline.time;
      world.restore(record.baseline);
      replay.rebase();
      replay.seek(selected.time);
      return selected;
    }
    const module = {
      validateInputs,
      state: (value) => state(value, 0),
      staticState: (value) => state(value, 3),
      experimentState: (value, authored) => state(value, authored.time),
      operations: {
        surface: (value, progress) =>
          state({ ...inputsOf(value), friction: progress === 1 ? 0.3 : value.friction }, 0),
        push: (value, progress) => state(inputsOf(value), 3 * progress),
        finish: (value) => state(inputsOf(value), 3),
      },
      validateViews(views) {
        if (views.some((v) => !['block-stage', 'block-measurement'].includes(v.kind)))
          throw Error('Unknown block view.');
      },
      focusTargets: () => ['block', 'experimenter', 'distance-plot'],
    };
    return {
      world,
      block,
      ground,
      module,
      state,
      seek,
      liveState: () => ({
        ...sample(),
        trace: recording(inputs).trace,
        engine: 'Rapier 2D 0.21.0',
        stepSeconds: world.stepSeconds,
      }),
      get time() {
        return Math.round((world.time - origin) / world.stepSeconds) * world.stepSeconds;
      },
      dispose() {
        records.clear();
        world.dispose();
      },
    };
  } catch (cause) {
    world.dispose();
    throw cause;
  }
}
