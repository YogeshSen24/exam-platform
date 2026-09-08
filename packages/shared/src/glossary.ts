/**
 * Plain-language explanations for every technical term the interface shows.
 * The UI renders these in tooltips and information panels so non-technical
 * stakeholders can follow a demonstration without a security background.
 */

export interface GlossaryEntry {
  term: string;
  short: string;
  long: string;
  /** Whether the POC implements this for real or demonstrates it. */
  pocStatus: 'implemented' | 'simulated' | 'partial';
  pocNote?: string;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  hash: {
    term: 'Hash',
    short: 'A unique fingerprint that changes if the question changes.',
    long: 'A hash is a short code calculated from content. Change a single character and the code changes completely, so it is easy to detect whether anything was altered after approval.',
    pocStatus: 'implemented',
    pocNote: 'SHA-256 over a canonical representation of each question version.',
  },
  digitalSignature: {
    term: 'Digital signature',
    short: 'Proof that the approved authority published this exact paper.',
    long: 'A digital signature is created with a private key held by the approving authority. Anyone with the matching public key can confirm both who approved the paper and that it has not changed since.',
    pocStatus: 'implemented',
    pocNote: 'Ed25519 signatures using development keys, not an HSM-held production key.',
  },
  encryption: {
    term: 'Encryption',
    short: 'Keeps the question unreadable until the authorised examination window.',
    long: 'The question package is scrambled with a key. Without that key the stored content is meaningless, so a copy taken from storage or a backup reveals nothing.',
    pocStatus: 'implemented',
    pocNote: 'AES-256-GCM with a random per-exam data key and a unique nonce per operation.',
  },
  deviceCertificate: {
    term: 'Device certificate',
    short: 'A digital identity issued to an approved examination computer.',
    long: 'Each approved workstation is issued a certificate. The server checks it before allowing an examination to start, so an unknown laptop cannot join the examination network and pretend to be an exam machine.',
    pocStatus: 'partial',
    pocNote: 'Certificate records, expiry and revocation are real. Mutual TLS termination is simulated.',
  },
  ipAllowlist: {
    term: 'IP allowlist',
    short: 'Allows connections only from approved examination-centre networks.',
    long: 'The server accepts examination traffic only from the network ranges the organisation has registered for its centres. It does not replace encryption or candidate verification — it simply narrows where a connection may come from.',
    pocStatus: 'implemented',
    pocNote: 'Enforced per request; a demo header can simulate an off-network workstation.',
  },
  idempotencyKey: {
    term: 'Idempotency key',
    short: 'Prevents a retried answer from being saved twice.',
    long: 'When the network is unreliable the workstation may send the same answer more than once. Each send carries a unique key so the server can recognise a repeat and record it only once.',
    pocStatus: 'implemented',
  },
  immutableAudit: {
    term: 'Immutable audit log',
    short: 'A history designed so actions cannot be silently rewritten.',
    long: 'Each audit entry includes the fingerprint of the entry before it. Removing or editing any entry breaks the chain, which makes tampering detectable.',
    pocStatus: 'partial',
    pocNote: 'Append-only hash-chained application records. Production requires independent WORM storage.',
  },
  manifest: {
    term: 'Exam manifest',
    short: 'The signed list of exactly which questions make up the paper.',
    long: 'The manifest records every approved question version in the paper together with its fingerprint. It is signed as a whole, so neither the list nor any individual question can be swapped without detection.',
    pocStatus: 'implemented',
  },
  kms: {
    term: 'Key management service (KMS/HSM)',
    short: 'The controlled place where encryption keys live.',
    long: 'Keys that unlock the paper are held separately from the question data and released only under policy — for example, inside the examination window and only to authorised services.',
    pocStatus: 'simulated',
    pocNote: 'A local development key provider stands in. Development keys are not suitable for production.',
  },
  liveness: {
    term: 'Liveness check',
    short: 'Confirms a real person is present rather than a photograph.',
    long: 'A short interactive check asks the candidate to perform an action in front of the camera, which is difficult to satisfy with a still image or recording.',
    pocStatus: 'simulated',
    pocNote: 'POC biometric simulation — outcomes are scripted for demonstration.',
  },
  attestation: {
    term: 'Device attestation',
    short: 'The workstation proves its own security configuration.',
    long: 'The examination computer reports verifiable evidence about its state — secure boot, disk encryption, kiosk policy and application signature — before it is trusted with a paper.',
    pocStatus: 'simulated',
    pocNote: 'A browser cannot attest the operating system. Results shown here are demonstration data.',
  },
  optimisticConcurrency: {
    term: 'Version-controlled updates',
    short: 'Stops an older answer from overwriting a newer one.',
    long: 'Every saved answer carries a version number. If two updates race, the server accepts the expected one and reports a conflict for the other instead of silently losing work.',
    pocStatus: 'implemented',
  },
  answerSetHash: {
    term: 'Answer-set fingerprint',
    short: 'One code that summarises every submitted answer.',
    long: 'At submission the server calculates a single fingerprint over the candidate’s final answers. The receipt carries that fingerprint, so a later dispute can confirm whether the stored answers are the ones submitted.',
    pocStatus: 'implemented',
  },
  ddos: {
    term: 'DDoS protection',
    short: 'Absorbs floods of traffic aimed at making the exam unavailable.',
    long: 'Upstream protection filters large volumes of hostile traffic before it reaches the examination service, so genuine candidates can keep working.',
    pocStatus: 'simulated',
    pocNote: 'The operations console generates synthetic monitoring events. No real attack traffic exists.',
  },
  kioskMode: {
    term: 'Kiosk mode',
    short: 'Locks the computer to the examination application only.',
    long: 'The operating system is configured so the examination application is the only thing that runs, and the candidate cannot reach other applications, settings or storage.',
    pocStatus: 'simulated',
    pocNote: 'This browser POC cannot enforce operating-system lockdown. A native Windows shell would.',
  },
};

export type GlossaryKey = keyof typeof GLOSSARY;
