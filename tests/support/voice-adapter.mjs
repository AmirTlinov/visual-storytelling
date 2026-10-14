// Protocol/ownership fixture: tone intervals have measured phrase timestamps.
// It is deliberately not a TTS model or a listening-quality acceptance test.
export const voiceAdapter = `import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
let input = ''; for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input), mode = request.model;
await appendFile(join(process.cwd(), '.voice-calls'), JSON.stringify({provider:request.provider,text:request.text,model:mode,voice:request.voice})+'\\n');
if (mode === 'secret') { console.error('SECRET-api-token'); console.log('SECRET-api-token'); process.exit(17); }
if (mode === 'bad-json') { console.log('SECRET-api-token'); process.exit(0); }
if (mode === 'overflow') { console.log('SECRET-api-token'.repeat(80000)); process.exit(0); }
if (['child', 'exit-child', 'exit-success-child'].includes(mode)) {
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},100)"], {stdio:'inherit'});
  await writeFile(join(process.cwd(), '.voice-child'), String(child.pid));
  if (mode === 'exit-child') process.exit(1);
  if (mode === 'exit-success-child') process.exit(0);
  await new Promise(resolve=>setTimeout(resolve,30000));
}
if (mode === 'wait') {
  await writeFile(join(process.cwd(), '.voice-started'), 'yes');
  await new Promise(resolve=>setTimeout(resolve,400));
}
if (mode === 'changed-adapter') await appendFile(new URL(import.meta.url), '\\n// changed during synthesis\\n');
const rate=8000, frames=16000, pcm=Buffer.alloc(frames*2), header=Buffer.alloc(44);
for(let i=800;i<15200;i++) pcm.writeInt16LE(Math.round(Math.sin(i/9)*2000),i*2);
header.write('RIFF');header.writeUInt32LE(pcm.length+36,4);header.write('WAVEfmt ',8);
header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(mode==='stereo'?2:1,22);
header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);header.writeUInt16LE(2,32);
header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
let audio=Buffer.concat([header,pcm]); if(mode==='truncated') audio=audio.subarray(0,-1);
await writeFile(join(request.outputDirectory,'take.wav'),audio);
let words=[{text:request.text,start:.1,end:1.9}];
if(mode==='word-precision') {
  const tokens=request.text.match(/[\\p{L}\\p{N}]+(?:-[\\p{L}\\p{N}]+)*/gu);
  words=tokens.map((text,i)=>({text,start:.1+i*1.8/tokens.length,end:.1+(i+1)*1.8/tokens.length}));
}
if(mode==='missing') words=[{text:'Один',start:.1,end:1.9}];
if(mode==='overlap') words=[{text:'Один',start:.1,end:1.3},{text:'шаг вправо.',start:1.2,end:1.9}];
if(mode==='outside') words=[{text:request.text,start:.1,end:2.1}];
if(mode==='nonfinite') words=[{text:request.text,start:NaN,end:1.9}];
console.log(JSON.stringify({words,alignment:{method:'fixture-phrase-tones'}}));
`;
