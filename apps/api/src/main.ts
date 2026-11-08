import { createApp } from './app/create-app.js';
import { loadConfig } from './app/config.js';

/** Hard limit for a graceful shutdown; collab's own close() budget (8 s) fits inside it. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main() {
  const config = loadConfig(process.env);
  const app = await createApp(config);
  await app.server.listen({ port: config.port, host: config.host });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      app.server.log.warn({ signal }, 'second signal received, forcing exit');
      process.exit(1);
    }
    shuttingDown = true;
    app.server.log.info({ signal }, 'shutting down');
    const timer = setTimeout(() => {
      app.server.log.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.server.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
