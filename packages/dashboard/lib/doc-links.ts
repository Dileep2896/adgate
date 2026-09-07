/**
 * The two documents an operator wiring up an app actually needs, named the way the repo
 * names them. Pure and import free, so the client-side integration panel can use it.
 *
 * WHY THESE ARE PATHS AND NOT URLS. adgate is self hosted and has no canonical docs site:
 * there is no homepage in any package.json and no published URL anywhere in the repo, so an
 * https:// link here would be a guess, and a guess that 404s is worse than no link. The
 * dashboard is served from the checkout - lib/env.ts finds the repo root at runtime by
 * walking up to pnpm-workspace.yaml - so the file is genuinely there, next to the process
 * rendering this page, and the path is the instruction. If a deployment does publish its
 * docs, give DocRef an `href` and it renders a real anchor instead.
 */

export const DOC_PATHS = {
  integration: 'docs/integration.md',
  deploy: 'docs/deploy.md',
  policy: 'docs/policy.md',
} as const;

export type DocName = keyof typeof DOC_PATHS;

export const DOC_TITLES: Record<DocName, string> = {
  integration:
    'Wiring an app to this gateway: web chat, agent loops and CLIs, in TypeScript and Python',
  deploy:
    'Running this gateway in production: keys, retention, proxies and the dashboard allowlist',
  policy:
    'What a policy decides, field by field, including the demand list that says which networks are queried',
};

export const docPath = (doc: DocName): string => DOC_PATHS[doc];
