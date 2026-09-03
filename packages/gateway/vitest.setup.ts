import { loadRootEnvFile } from './src/env-file.js';

// Local runs read DATABASE_URL_TEST from the repo-root .env (git ignored). CI has no .env and
// exports the variable in the job env instead; variables already set always win over the file.
loadRootEnvFile();
