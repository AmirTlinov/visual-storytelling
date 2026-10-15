import { readFile } from 'node:fs/promises';
import { benchmarkRequest } from './benchmark-request.mjs';

// Shell/SDK fallback. No authoring, operation selection, state evaluation or timing here.
const endpoint = JSON.parse(await readFile(process.argv[2], 'utf8'));
let input = '';
for await (const chunk of process.stdin) input += chunk;
const result = await benchmarkRequest(endpoint, JSON.parse(input));
// The browser owner already retained the exact image at path; never print base64 in logs.
const { png, ...observation } = result;
console.log(JSON.stringify(png ? observation : result));
