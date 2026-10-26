import { projectCreation } from './project-creation.mjs';
import { projectTransactions } from './project-transactions.mjs';

/** Compose authorship around the existing project, job and session owners. */
export function projectAuthoring(options) {
  const transactions = projectTransactions(options);
  const creation = projectCreation({
    ...options,
    commitPrepared: transactions.commitPrepared,
    resumeCommitted: transactions.resumeCommitted,
  });
  return { ...transactions, ...creation };
}
