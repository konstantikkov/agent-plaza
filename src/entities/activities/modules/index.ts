import type { ActivityModule } from '../types';
import { sandbox } from './sandbox';
import { chess } from './chess';
import { go } from './go';
import { stage } from './stage';

/** kind -> module. build.ts / StationsView skip any kind missing here. */
export const MODULES: Partial<Record<string, ActivityModule>> = {
  sandbox,
  chess,
  go,
  stage,
};
