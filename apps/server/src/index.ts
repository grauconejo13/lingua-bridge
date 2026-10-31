import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { loadConfig } from './config';
import { createProvider } from './providers';

const here = dirname(fileURLToPath(import.meta.url));

// Load .env from the repo root (or the current directory) if one exists.
for (const candidate of [resolve(process.cwd(), '.env'), resolve(here, '../../../.env')]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

// Works from both src/ (dev) and dist/ (build): each is two levels below apps/.
const webDistDir = resolve(here, '../../web/dist');

const config = loadConfig(process.env, webDistDir);
const provider = createProvider(config);
const app = await buildApp({ config, provider });

if (provider.demoMode) {
  app.log.warn('PROVIDER=mock: responses are placeholder text, not real translation.');
}

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
