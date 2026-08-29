import { pathToFileURL } from 'node:url';
import { createProductionServer, type ProductionApiServer } from './index.js';

export type RuntimeConfig = { host: '0.0.0.0'; port: number };

export function readRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const rawPort = env.PORT?.trim() || '3000';
  if (!/^\d+$/.test(rawPort)) throw new Error('PORT must be an integer between 1 and 65535');
  const port = Number(rawPort);
  if (port < 1 || port > 65_535) throw new Error('PORT must be an integer between 1 and 65535');
  return { host: '0.0.0.0', port };
}

export async function startRuntime(env: NodeJS.ProcessEnv = process.env): Promise<ProductionApiServer> {
  const config = readRuntimeConfig(env);
  const server = createProductionServer(env);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  console.log(`Investment OS API listening on http://${config.host}:${config.port}`);

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down API`);
    server.close(async (error) => {
      process.removeListener('SIGINT', shutdown);
      process.removeListener('SIGTERM', shutdown);
      let shutdownFailed = error !== undefined;
      try { await server.closeResources(); }
      catch { shutdownFailed = true; }
      if (shutdownFailed) {
        console.error('API shutdown failed');
        process.exitCode = 1;
      }
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return server;
}

const executablePath = process.argv[1];
if (executablePath && import.meta.url === pathToFileURL(executablePath).href) {
  startRuntime().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'API startup failed');
    process.exitCode = 1;
  });
}
