# Объёмный морфинг

54-секундный рассказ: кубик → шар, два кубика → брусок, кубик и шар → капсула. Голос, главы, вращение и перемотка используют `SceneShell` и `Viewport3D`.

```js
import { Morph } from '@visual-storytelling/core';
import { Morph3D } from '@visual-storytelling/core/three';

const operation = Morph.merge(
  [Morph.box([1.15, 1.15, 0.97], 1), Morph.box([1.15, 1.15, 0.97], 2)],
  Morph.box([2.25, 1.15, 0.97], 3),
);
const morph = Morph3D.mount(view, operation, { pigment: 'blue' });
view.setObject(morph.object, { fitView: false });
morph.render(frame.progress('join'));
```

Движок задаёт сближение и контакт, сохраняет исходные грани до слияния, переносит штрихи на общую поверхность. GPU находит поверхность по полю расстояний; заливка, рёбра и надписи получают одну глубину. `setOperation` переиспользует компонент в следующей главе. [Общий API, 2D и физический контакт](../../docs/morphing.md).

```sh
npm run build
node tools/scene.mjs preview site/volume-morph --port 8822
node tools/scene.mjs pack site/volume-morph --out artifacts/volume-morph.html
```
