import { startTracking, stopTracking } from './services/trackingService.js';
import { buildApp } from './app.js';
import { env } from './config/env.js';
import { seedDatabase, DEMO_ACCOUNTS, DEMO_CANDIDATE_APPLICATION_ID, DEMO_CANDIDATE_PASSWORD } from './data/seed.js';
import { primeMetricsSeries, rollMetrics } from './services/opsService.js';
import { keyProvider } from './lib/crypto/keyProvider.js';

async function main() {
  const seeded = await seedDatabase();
  primeMetricsSeries();

  const app = await buildApp();
  startTracking();
  const interval = setInterval(rollMetrics, 60_000);
  interval.unref?.();

  await app.listen({ port: env.PORT, host: env.HOST });

  const provider = keyProvider().describe();
  app.log.info(
    {
      exam: `${seeded.exam.name} (${seeded.exam.code})`,
      candidates: seeded.candidateCount,
      questions: seeded.questionCount,
      keyProvider: provider.displayName,
      persistence: env.PERSISTENCE_DRIVER,
    },
    'Demonstration data ready',
  );

  if (env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log(`
  ────────────────────────────────────────────────────────────────────────
  Secure Examination Management and Delivery Platform — proof of concept
  API      http://localhost:${env.PORT}/api/v1
  Docs     http://localhost:${env.PORT}/docs

  DEMO CREDENTIALS (development only — never deploy these)
${DEMO_ACCOUNTS.map((a) => `    ${a.role.padEnd(18)} ${a.email.padEnd(34)} ${a.password}`).join('\n')}
    CANDIDATE          ${DEMO_CANDIDATE_APPLICATION_ID.padEnd(34)} ${DEMO_CANDIDATE_PASSWORD}

  ${provider.warning ?? ''}
  ────────────────────────────────────────────────────────────────────────
`);
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down');
    clearInterval(interval);
    stopTracking();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
