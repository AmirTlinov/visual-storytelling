import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat,utimes,rename,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withVerifiedInputs,verifiedInputWork} from '../tools/input-verification.mjs';
import {projectFiles,snapshotProject} from '../tools/project-files.mjs';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'verified-inputs-'));t.after(()=>rm(root,{recursive:true,force:true}));const source=join(root,'source');await mkdir(source);await writeFile(join(source,'value.txt'),'first');return{root,source};}

test('one operation reuses content proof, but metadata-preserved writes and replacements are rehashed',async t=>{
 const{source}=await fixture(t);await withVerifiedInputs(async()=>{
  const first=await projectFiles(source),initial=verifiedInputWork();
  assert.equal(initial.hashes,1);assert.equal(initial.readBytes,5);
  assert.deepEqual(await projectFiles(source),first);assert.equal(verifiedInputWork().hashes,1);assert.equal(verifiedInputWork().hits,1);
  const path=join(source,'value.txt'),original=await stat(path);await writeFile(path,'other');await utimes(path,original.atime,original.mtime);
  const changed=await projectFiles(source);assert.notEqual(changed.revision,first.revision);assert.equal(verifiedInputWork().hashes,2);
  await writeFile(join(source,'replacement'),'third');await utimes(join(source,'replacement'),original.atime,original.mtime);await rename(join(source,'replacement'),path);
  assert.notEqual((await projectFiles(source)).revision,changed.revision);assert.equal(verifiedInputWork().hashes,3);
 });
 await withVerifiedInputs(async()=>{await projectFiles(source);assert.equal(verifiedInputWork().hashes,1,'new operation starts with content verification');});
});

test('snapshots reuse verified hashes without sharing mutable inode; directory changes and escaping links still fail',async t=>{
 const{root,source}=await fixture(t);await withVerifiedInputs(async()=>{
  const before=await projectFiles(source),target=join(root,'snapshot');await snapshotProject(source,target,before.revision);
  const work=verifiedInputWork();assert.equal(work.hashes,2);assert.equal(work.copiedBytes,5);assert(work.hits>=2);
  assert.notEqual((await stat(join(source,'value.txt'))).ino,(await stat(join(target,'value.txt'))).ino);
  await writeFile(join(source,'new.txt'),'added');assert.notEqual((await projectFiles(source)).revision,before.revision);
  await writeFile(join(source,'value.txt'),'source changed');assert.equal(await readFile(join(target,'value.txt'),'utf8'),'first');
  await symlink(join(root,'snapshot'),join(source,'escape'));await assert.rejects(projectFiles(source),/leaves its directory/);
 });
});

test('a delayed callback cannot retain a closed operation proof cache',async t=>{
 const{source}=await fixture(t);let delayed;
 await withVerifiedInputs(async()=>{
  await projectFiles(source);
  delayed=new Promise((resolve,reject)=>setTimeout(async()=>{try{await projectFiles(source);resolve(verifiedInputWork());}catch(error){reject(error);}},20));
 });
 assert.deepEqual(await delayed,{});
});
