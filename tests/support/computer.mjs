import { DisplayModel } from '../../examples/computer-explorer/display/model.js';
import { NandModel } from '../../examples/computer-explorer/storage/nand-model.js';
import { ImageJob } from '../../examples/computer-explorer/image-job/model.js';
export { DisplayModel, NandModel, ImageJob };
export function machine(architecture, saved) {
  const nand = new NandModel(),
    display = new DisplayModel();
  nand.restore(saved?.nand);
  display.restore(saved?.display);
  const job = new ImageJob(nand, display, () => architecture);
  if (saved) job.restore(saved.imageJob);
  else job.start();
  return { nand, display, job };
}
export function snapshot(architecture, m) {
  return {
    version: 2,
    architecture,
    keys: [],
    values: {},
    nand: m.nand.snapshot(),
    display: m.display.snapshot(),
    imageJob: m.job.snapshot(),
  };
}
export function at(architecture, phase) {
  const m = machine(architecture);
  let limit = 1200;
  while (m.job.phase !== phase && --limit) m.job.step();
  if (!limit) throw new Error('Unreachable phase ' + phase);
  return snapshot(architecture, m);
}
export function finish(m) {
  let limit = 1200;
  while (!m.job.done && --limit) m.job.step();
  if (!m.job.done) throw new Error('Pipeline stalled');
}
