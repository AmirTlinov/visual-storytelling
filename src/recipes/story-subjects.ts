import { fractionsSubject } from './fractions-subject.js';
import { divisionSubject } from './division-subject.js';
import { instructionalRouteSubject } from './dependency-route-subject.js';
import type { StorySubjects } from '../story/subject.js';
export const storySubjects: StorySubjects = {
  division: divisionSubject,
  fractions: fractionsSubject,
  'dependency-route': instructionalRouteSubject,
};
export function storySubjectOwners(subjects: StorySubjects = {}) {
  for (const id of Object.keys(subjects))
    if (Object.hasOwn(storySubjects, id))
      throw new Error(`Subject drawing already has an owner: ${id}`);
  return { ...storySubjects, ...subjects };
}
