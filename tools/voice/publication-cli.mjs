import { publishNarration, recoverNarration, assertNarrationPublished } from './publication.mjs';

try {
  const [command, directory, staging, names] = process.argv.slice(2);
  if (command === 'publish') await publishNarration(directory, staging, JSON.parse(names));
  else if (command === 'recover') await recoverNarration(directory);
  else if (command === 'check') await assertNarrationPublished(directory);
  else throw new Error('Unknown narration publication command.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
