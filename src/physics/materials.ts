/** Illustrative material presets. Visual pigment and drawing style stay with the view. */
export interface PhysicalMaterial {
  friction: number;
  restitution: number;
  damping: number;
  /** Hz; omitted for a rigid body. */
  softness?: number;
}

export const physicalMaterials = {
  solid: { friction: 0.6, restitution: 0.12, damping: 0.08 },
  rubber: { friction: 0.85, restitution: 0.55, damping: 0.15, softness: 18 },
  jelly: { friction: 0.65, restitution: 0.08, damping: 0.3, softness: 5 },
} satisfies Record<string, PhysicalMaterial>;
export type MaterialChoice = keyof typeof physicalMaterials | PhysicalMaterial;

export function material(choice: MaterialChoice = 'solid'): PhysicalMaterial {
  const value: PhysicalMaterial = typeof choice === 'string' ? physicalMaterials[choice] : choice;
  if (
    !value ||
    ![value.friction, value.restitution, value.damping].every(Number.isFinite) ||
    value.friction < 0 ||
    value.restitution < 0 ||
    value.restitution > 1 ||
    value.damping < 0 ||
    (value.softness !== undefined && !(Number.isFinite(value.softness) && value.softness > 0))
  )
    throw new Error(
      'Physical materials need non-negative friction/damping, restitution in [0,1], and positive softness',
    );
  return { ...value };
}

export function positive(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive and finite`);
  return value;
}
export function coordinates(values: readonly number[], dimension: number) {
  if (values.length !== dimension || !values.every(Number.isFinite))
    throw new Error(`Expected ${dimension} finite coordinates`);
}
