import { Bone, Skeleton, SkinnedMesh, Vector3 } from 'three';
import { CCDIKSolver, type IK } from 'three/addons/animation/CCDIKSolver.js';
import type { CharacterPerformance } from '../performance.js';
import { boneLength } from '../rig.js';
import type { Point } from '../types.js';

/** Stage contacts use Three's solver on the same bones that draw the character. */
export function contactRig(
  perf: CharacterPerformance,
  chains: Record<string, { upper: Bone; lower: Bone }>,
  height: number,
) {
  const bones = [...perf.bones.values()];
  const entries = new Map<
    string,
    { target: Bone; end: Bone; constraint: IK; upper: Bone; lower: Bone }
  >();
  const constraints: IK[] = [];
  for (const [name, chain] of Object.entries(chains)) {
    const end = new Bone(),
      target = new Bone();
    end.name = `${name}:contact`;
    end.position.x = boneLength(chain.lower);
    chain.lower.add(end);
    target.name = `${name}:target`;
    perf.object.add(target);
    const constraint: IK = {
      target: bones.push(target) - 1,
      effector: bones.push(end) - 1,
      iteration: 128,
      links: [chain.lower, chain.upper].map((bone) => ({
        index: bones.indexOf(bone),
        limitation: new Vector3(0, 0, 1),
      })),
    };
    constraints.push(constraint);
    entries.set(name, { target, end, constraint, ...chain });
  }
  const mesh = new SkinnedMesh();
  mesh.skeleton = new Skeleton(bones);
  const solver = new CCDIKSolver(mesh, constraints),
    vector = new Vector3();
  return {
    point(name: string) {
      return perf.point(entries.get(name)!.end);
    },
    solve(name: string, at: Point, weight = 1, bend = -1) {
      const entry = entries.get(name)!;
      perf.object.updateMatrixWorld(true);
      vector.set(at.x, height - at.y, 0);
      perf.object.worldToLocal(vector);
      entry.target.position.copy(vector);
      // A reflected stage is a presentation transform. Solve in the rig's own
      // coordinates so CCD sees positive scale and a consistent bend direction.
      const position = perf.object.position.clone(),
        scale = perf.object.scale.clone();
      perf.object.position.set(0, 0, 0);
      perf.object.scale.set(1, 1, 1);
      perf.object.updateMatrixWorld(true);
      if (Math.abs(entry.lower.rotation.z) < 0.04) {
        entry.lower.rotation.z = bend * 0.04;
        entry.lower.updateMatrixWorld(true);
      }
      solver.updateOne(entry.constraint, weight);
      if (weight === 1) {
        const shoulder = entry.upper.getWorldPosition(new Vector3()),
          elbow = entry.lower.getWorldPosition(new Vector3()),
          tip = entry.end.getWorldPosition(new Vector3()),
          target = entry.target.getWorldPosition(new Vector3());
        const reachable =
          shoulder.distanceTo(target) < shoulder.distanceTo(elbow) + elbow.distanceTo(tip);
        // Nearly straight supports converge more slowly. Refine only a reachable
        // full contact; reapplying a partial gesture would change its authored weight.
        if (reachable)
          for (let attempt = 0; attempt < 3 && tip.distanceTo(target) > 0.004; attempt++) {
            solver.updateOne(entry.constraint, 1);
            entry.end.getWorldPosition(tip);
          }
      }
      perf.object.position.copy(position);
      perf.object.scale.copy(scale);
      perf.object.updateMatrixWorld(true);
    },
    dispose() {
      for (const entry of entries.values()) {
        entry.target.removeFromParent();
        entry.end.removeFromParent();
      }
      mesh.skeleton.dispose();
      mesh.geometry.dispose();
      (mesh.material as import('three').Material).dispose();
    },
  };
}
