/** Attempt every release; retain the original failure objects and their order. */
export function releaseResources(resources: Iterable<() => void>, message: string) {
  const errors: unknown[] = [];
  for (const release of resources) {
    try {
      release();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, message);
}
