import { validateStoryDocument } from '../dist/story/document.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  appendFile,
  chmod,
  cp,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { writeBuildInfo } from '../tools/build-info.mjs';
import { createScene } from '../tools/create-scene.mjs';
import { installRelease } from '../plugin/install.mjs';
import { pluginHost } from './plugin/host.mjs';
import { finishFixtureJob } from './plugin/authoring-fixture.mjs';

const readJSON = async (file) => JSON.parse(await readFile(file, 'utf8'));
const document = validateStoryDocument({
  recipe: 'division',
  id: 'apples',
  inputs: { count: 11, divisor: 3 },
});

async function unlockDirectories(directory) {
  await chmod(directory, 0o700);
  for (const entry of await readdir(directory, { withFileTypes: true }))
    if (entry.isDirectory()) await unlockDirectories(join(directory, entry.name));
}

async function until(check, message) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(40);
  }
  throw new Error(message);
}

test(
  'a prepared project migrates between distinct trusted pins and retains semantic editing, undo and reopen',
  { timeout: 120000 },
  async (t) => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'story-live-migration-')));
    const root = fileURLToPath(new URL('../', import.meta.url));
    const currentRelease = await realpath(join(root, '.plugin-release'));
    const previousInstallation = process.env.VISUAL_STORY_INSTALL_DIR;
    const installation = join(directory, 'installation');
    process.env.VISUAL_STORY_INSTALL_DIR = installation;
    let host, browser;
    try {
      // A distinct earlier package fixture uses the real prepared code. Only its
      // shipped documentation differs; no compilation or trust exception is needed.
      const source = join(directory, 'previous-release');
      await cp(currentRelease, source, { recursive: true, verbatimSymlinks: true });
      await appendFile(
        join(source, 'README.md'),
        '\n<!-- GUI-561 previous immutable package fixture -->\n',
      );
      const previousReceipt = await writeBuildInfo(source, join(source, 'dist'));
      const release = await readJSON(join(source, 'release.json'));
      release.core.build = previousReceipt.build;
      await writeFile(join(source, 'release.json'), JSON.stringify(release, null, 2) + '\n');
      const installed = await installRelease(source, { directory: installation, register: false });
      const currentReceipt = await readJSON(join(currentRelease, 'dist/build-info.json'));
      assert.notEqual(
        previousReceipt.build,
        currentReceipt.build,
        'migration must change package identity',
      );

      const projectPath = join(directory, 'project');
      await createScene(projectPath, {
        root: installed.release,
        title: 'Живая миграция',
        document,
      });
      const oldPin = await readJSON(join(projectPath, 'scene-runtime.json'));
      assert.equal(oldPin.root, installed.release);
      assert.equal(oldPin.build, previousReceipt.build);

      host = await pluginHost({
        dataDirectory: join(directory, 'data'),
        initialTarget: { path: projectPath },
        serverEntry: join(currentRelease, 'plugin/dist/server.mjs'),
      });
      const call = async (name, args) => {
        const result = await host.client.callTool({ name, arguments: args });
        assert.equal(result.isError, undefined, JSON.stringify(result));
        return result.structuredContent;
      };
      const opening = await call('story_open', { path: projectPath });
      const initialBuild = opening.jobs.find((job) => job.kind === 'build');
      assert.ok(initialBuild, 'opening the existing project exercises its ordinary build');
      await finishFixtureJob(host.client, initialBuild.id);
      browser = await chromium.launch(chromiumLaunchOptions({ headless: true }));
      const page = await browser.newPage({ viewport: { width: 820, height: 850 } });
      page.setDefaultTimeout(20000);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(host.url);
      const app = page.frameLocator('iframe[title="MCP App"]');
      await app.locator('html[data-connection="connected"]').waitFor();
      const sessionId = await page.evaluate(() => window.pluginTest.session.sessionId);
      const projectId = opening.projectId;
      const sceneState = () =>
        app
          .frameLocator('#scene')
          .locator('main')
          .evaluate((root) => ({
            document: root.scene.authoring?.document,
            parameters: Object.fromEntries(
              root.scene.inspect().parameters.map((parameter) => [parameter.key, parameter.value]),
            ),
            authoring: typeof root.scene.authoring?.replace === 'function',
          }));
      const initial = await sceneState();
      assert.deepEqual(initial.document, document);
      assert.equal(initial.authoring, true);
      let inspected = await call('story_inspect', { sessionId });
      await call('story_control', {
        context: inspected.context,
        commands: [{ type: 'parameters', values: { divisor: 4 } }],
        requestId: randomUUID(),
      });
      assert.equal((await sceneState()).parameters.divisor, 4);
      const before = await call('story_inspect', { projectId });
      const migrationRequest = {
        context: before.context,
        requestId: randomUUID(),
      };
      const migration = await call('story_migrate', migrationRequest);
      const migrated = await finishFixtureJob(host.client, migration.id);
      assert.ok(migrated.result.project, 'migration committed a real project edit');
      assert.notEqual(migrated.result.project.sourceRevision, before.sourceRevision);
      assert.deepEqual(
        await call('story_migrate', migrationRequest),
        migrated,
        'retry returns the original job after migration changed the working revision',
      );
      await assert.rejects(
        call('story_migrate', {
          ...migrationRequest,
          changes: [{ path: 'different.txt', content: 'new intent' }],
        }),
        /requestId already belongs/,
      );
      assert.equal(
        migrated.result.job,
        undefined,
        'migration publishes its already verified build',
      );
      const rebuilt = migrated;
      inspected = await until(async () => {
        const result = await host.client.callTool({
          name: 'story_inspect',
          arguments: { sessionId },
        });
        if (
          result.isError &&
          result.structuredContent?.error?.message ===
            'The scene is moving to another view. Inspect after it opens.'
        )
          return false;
        assert.equal(result.isError, undefined, JSON.stringify(result));
        const observation = result.structuredContent;
        return observation.buildRevision === rebuilt.result.buildRevision ? observation : false;
      }, 'The view did not switch to the migrated build');
      assert.equal(inspected.shownSourceRevision, migrated.result.project.sourceRevision);
      const newPin = await readJSON(join(projectPath, 'scene-runtime.json'));
      assert.equal(newPin.root, currentRelease);
      assert.equal(newPin.build, currentReceipt.build);
      assert.notDeepEqual(newPin, oldPin);
      assert.equal(
        (await readJSON(join(projectPath, 'package.json'))).dependencies[
          '@visual-storytelling/core'
        ],
        `file:${currentRelease}`,
      );
      const afterMigration = await sceneState();
      assert.deepEqual(afterMigration.document, document);
      assert.equal(
        afterMigration.parameters.divisor,
        4,
        'runtime migration restores viewer conditions',
      );
      assert.equal(afterMigration.authoring, true);

      const edited = await call('story_edit', {
        context: migrated.result.project.context,
        requestId: randomUUID(),
        operations: [{ op: 'set-inputs', modelId: 'apples', values: { count: 17 } }],
      });
      assert.equal(edited.shown.length, 1);
      assert.equal(edited.shown[0].acknowledgement, 'rendered');
      assert.equal(edited.shown[0].shownSourceRevision, edited.project.sourceRevision);
      const changed = await sceneState();
      assert.equal(changed.document.models[0].inputs.count, 17);
      assert.equal(changed.parameters.count, 17);
      assert.equal(changed.parameters.divisor, 4);
      const undone = await call('story_edit', {
        context: edited.project.context,
        requestId: randomUUID(),
        undo: true,
      });
      assert.equal(undone.shown[0].acknowledgement, 'rendered');
      assert.equal((await sceneState()).document.models[0].inputs.count, 11);
      assert.deepEqual(
        await readJSON(join(projectPath, 'scene-runtime.json')),
        newPin,
        'semantic undo retains the migrated runtime',
      );

      await page.evaluate(() => window.pluginTest.remount());
      await app.locator('html[data-connection="connected"]').waitFor();
      const reopened = await call('story_inspect', { sessionId });
      assert.equal(reopened.shownSourceRevision, undone.project.sourceRevision);
      const restored = await sceneState();
      assert.deepEqual(restored.document, document);
      assert.equal(restored.parameters.count, 11);
      assert.equal(restored.parameters.divisor, 4);
      assert.equal(restored.authoring, true);
      assert.deepEqual(await readJSON(join(projectPath, 'scene-runtime.json')), newPin);
      assert.deepEqual(errors, []);
      t.diagnostic(
        JSON.stringify({
          from: oldPin.build,
          to: newPin.build,
          shownSourceRevision: reopened.shownSourceRevision,
        }),
      );
    } finally {
      await browser?.close();
      await host?.close();
      if (previousInstallation === undefined) delete process.env.VISUAL_STORY_INSTALL_DIR;
      else process.env.VISUAL_STORY_INSTALL_DIR = previousInstallation;
      await unlockDirectories(directory);
      await rm(directory, { recursive: true, force: true });
    }
  },
);
