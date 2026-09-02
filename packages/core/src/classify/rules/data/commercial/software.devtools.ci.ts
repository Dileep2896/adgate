import type { CommercialRuleSet } from '../../types.js';

/** CI/CD: build and pipeline services and runners. */
export const SOFTWARE_DEVTOOLS_CI: CommercialRuleSet = {
  category: 'software.devtools.ci',
  products: [
    'ci service', 'ci services', 'ci provider', 'ci providers', 'ci tool', 'ci tools',
    'ci platform', 'ci cd service', 'ci cd tool', 'ci cd platform', 'ci cd provider',
    'continuous integration service', 'github actions', 'gitlab ci', 'circleci', 'circle ci',
    'buildkite', 'travis ci', 'travisci', 'jenkins', 'teamcity', 'drone ci', 'semaphore ci',
    'bitbucket pipelines', 'azure pipelines', 'azure devops', 'build service', 'ci runner',
    'ci runners', 'hosted runners', 'self hosted runners', 'codemagic', 'bitrise', 'ci minutes',
    'build minutes',
  ],
  topics: [
    'ci', 'ci cd', 'continuous integration', 'continuous delivery', 'continuous deployment',
    'pipeline', 'pipelines', 'build pipeline', 'build times', 'flaky tests', 'test runner',
    'runner', 'runners', 'yaml pipeline', 'deploy pipeline', 'release pipeline', 'monorepo ci',
    'build server', 'build cache', 'build step', 'github workflow',
  ],
  patterns: [
    String.raw`\b(ci|ci cd|continuous integration|build) (service|services|provider|providers|tool|tools|platform|platforms|vendor|vendors|system|systems|solution|solutions)\b`,
  ],
};
