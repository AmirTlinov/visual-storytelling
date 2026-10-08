import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
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
  assert.ok(result.textures.length > 1);
  for (const texture of result.textures) {
    const image = await sharp(Buffer.from(texture.split(',')[1], 'base64')).metadata();
    assert.ok(image.width <= 64 && image.height <= 64);
  }
  assert.deepEqual(result.regions.duplicate, result.regions['art-0']);
  for (const [i, a] of sprites.slice(0, 11).entries())
    for (const b of sprites.slice(i + 1, 11)) {
      const x = result.regions[a.path],
        y = result.regions[b.path];
      assert.ok(
        x.texture !== y.texture ||
          x.offset[0] + x.scale[0] <= y.offset[0] ||
          y.offset[0] + y.scale[0] <= x.offset[0] ||
          x.offset[1] + x.scale[1] <= y.offset[1] ||
          y.offset[1] + y.scale[1] <= x.offset[1],
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
    await Promise.all(
      edge.textures.map(async (uri) => {
        const m = await sharp(Buffer.from(uri.split(',')[1], 'base64')).metadata();
        return [m.width, m.height];
      }),
    ),
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
  const source = JSON.parse(pack.gltf);
  for (const image of source.images) {
    const size = await sharp(Buffer.from(image.uri.split(',')[1], 'base64')).metadata();
    assert.ok(size.width <= 2048 && size.height <= 2048);
  }
  assert.ok(pack.appearances['historian-32@back']);
});
