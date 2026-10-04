import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import sharp from 'sharp';
import { TextureAtlas } from '@esotericsoftware/spine-webgl';
import { characterAtlas } from '../tools/characters/atlas.mjs';
import { compileCharacterPack } from '../tools/characters/compile.mjs';

test('atlas pages have bounded dimensions and aliases reuse pixels without overlapping different art', async () => {
  const sprites = [];
  for (let i = 0; i < 11; i++)
    sprites.push({
      path: `art-${i}`,
      w: 22,
      h: 22,
      buffer: await sharp({
        create: {
          width: 22,
          height: 22,
          channels: 4,
          background: { r: 20 * i, g: 80, b: 210, alpha: 1 },
        },
      })
        .png()
        .toBuffer(),
    });
  sprites.push({ ...sprites[0], path: 'duplicate' });
  const result = await characterAtlas(sprites, { pageSize: 64 });
  const atlas = new TextureAtlas(result.atlas);
  assert.ok(atlas.pages.length > 1);
  for (const page of atlas.pages) {
    const image = await sharp(
      Buffer.from(result.textures[page.name].split(',')[1], 'base64'),
    ).metadata();
    assert.ok(image.width <= 64 && image.height <= 64);
    assert.equal(image.width, page.width);
    assert.equal(image.height, page.height);
  }
  const original = atlas.findRegion('art-0'),
    alias = atlas.findRegion('duplicate');
  assert.equal(alias.page, original.page);
  assert.equal(alias.u, original.u);
  assert.equal(alias.v, original.v);
  for (const [i, a] of sprites.slice(0, 11).entries())
    for (const b of sprites.slice(i + 1, 11)) {
      const x = atlas.findRegion(a.path),
        y = atlas.findRegion(b.path);
      assert.ok(
        x.page !== y.page ||
          x.x + x.width <= y.x ||
          y.x + y.width <= x.x ||
          x.y + x.height <= y.y ||
          y.y + y.height <= x.y,
      );
    }
  await assert.rejects(characterAtlas([{ ...sprites[0], w: 63 }], { pageSize: 64 }), /exceeds/);
  const edge = await characterAtlas(
    await Promise.all(
      sprites.slice(0, 2).map(async (s) => ({
        ...s,
        w: 10,
        h: 10,
        buffer: await sharp(s.buffer).resize(10, 10).png().toBuffer(),
      })),
    ),
    { pageSize: 16 },
  );
  assert.deepEqual(
    new TextureAtlas(edge.atlas).pages.map((p) => [p.width, p.height]),
    [
      [16, 16],
      [16, 16],
    ],
  );
});

test('thirty-three compatible characters compile into bounded atlas pages with all views', async () => {
  const template = fileURLToPath(new URL('../src/assets/characters/chibi/', import.meta.url));
  const pack = await compileCharacterPack(
    template,
    Array.from({ length: 33 }, (_, i) => ({
      directory: template + 'tesla',
      profile: {
        id: `historian-${i}`,
        palette: { '#34475b': `#${(0x305060 + i * 381).toString(16)}` },
      },
    })),
  );
  assert.equal(pack.skins.length, 33);
  const source = JSON.parse(gunzipSync(Buffer.from(pack.gzip, 'base64')));
  const atlas = new TextureAtlas(source.atlas);
  for (const page of atlas.pages) assert.ok(page.width <= 2048 && page.height <= 2048);
  assert.equal(Object.keys(source.textures).length, atlas.pages.length);
  assert.ok(source.data.skins.some((s) => s.name === 'historian-32@back'));
});
