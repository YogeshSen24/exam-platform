import { seedDatabase, currentSeedSummary, DEMO_ACCOUNTS, DEMO_CANDIDATE_APPLICATION_ID, DEMO_CANDIDATE_PASSWORD } from './seed.js';

/**
 * `npm run seed` — rebuilds the demonstration dataset.
 *
 * With PERSISTENCE_DRIVER=memory the dataset is rebuilt at every API start, so
 * this command exists mainly to verify the seed and print the demo credentials.
 */
async function main() {
  const started = Date.now();
  const result = await seedDatabase();
  const summary = currentSeedSummary();

  // eslint-disable-next-line no-console
  console.log(`
Demonstration data seeded in ${Date.now() - started} ms

  Examination      ${result.exam.name} (${result.exam.code})
  Manifest         ${result.manifestId}
  Exams            ${summary.exams}
  Questions        ${summary.questions}
  Candidates       ${summary.candidates}
  Workstations     ${summary.devices}
  Live attempts    ${summary.attempts}
  Audit events     ${summary.auditEvents}

  DEMO CREDENTIALS — development only, not for production use
${DEMO_ACCOUNTS.map((a) => `    ${a.role.padEnd(18)} ${a.email.padEnd(34)} ${a.password}`).join('\n')}
    CANDIDATE          ${DEMO_CANDIDATE_APPLICATION_ID.padEnd(34)} ${DEMO_CANDIDATE_PASSWORD}
`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
