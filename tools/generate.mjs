import { buildPackage } from './build-package.mjs';
import { execFileSync } from 'node:child_process';
await buildPackage();
for (const file of ['parameter-cube/cube.mjs', 'geometric-tensor/build.mjs'])
  execFileSync('node', [`examples/${file}`], { stdio: 'inherit' });
execFileSync('python3', ['examples/logic-gates/build.py'], { stdio: 'inherit' });
execFileSync('uv', ['run', '--python', '3.12', 'examples/lc-oscillator/build.py'], {
  stdio: 'inherit',
});
