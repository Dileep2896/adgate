import { loadRepoEnvFile } from './lib/env';

// The integration test needs DATABASE_URL_TEST. Local runs read it from the repo-root .env (git
// ignored); CI has no .env and exports the variable in the job environment instead, and
// variables already set always win over the file.
loadRepoEnvFile();
