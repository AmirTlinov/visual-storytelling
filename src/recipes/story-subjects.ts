import { samplingSubject } from './sampling-subject.js';
import { probabilitySubject } from './probability-subject.js';
import { leverSubject } from './lever.js';
import { leverComparisonSubject, routeComparisonSubject } from './comparison-owners.js';
import { fractionsSubject } from './fractions-subject.js';
import { divisionSubject } from './division-subject.js';
import { instructionalRouteSubject } from './dependency-route-subject.js';
import { circuitSubject } from './circuit-subject.js';
import type { StorySubjects } from '../story/subject.js';
export const storySubjects: StorySubjects = {
  probability: probabilitySubject,
  sampling: samplingSubject,
  division: divisionSubject,
  lever: leverSubject(),
  'lever-comparison': leverComparisonSubject,
  'route-comparison': routeComparisonSubject,
  fractions: fractionsSubject,
  circuit: circuitSubject,
  'dependency-route': instructionalRouteSubject,
};
export function storySubjectOwners(subjects: StorySubjects = {}) {
  for (const id of Object.keys(subjects))
    if (Object.hasOwn(storySubjects, id))
      throw new Error(`Subject drawing already has an owner: ${id}`);
  return { ...storySubjects, ...subjects };
}
