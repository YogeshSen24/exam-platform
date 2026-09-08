/**
 * Predefined security profiles.
 *
 * Administrators choose a named assurance level — never a raw cryptographic
 * algorithm. Each profile expands into a set of effective controls that the
 * UI displays in plain language and the API enforces.
 */

export const SECURITY_PROFILES = ['STANDARD', 'ENHANCED', 'HIGH_ASSURANCE', 'MAXIMUM_ASSURANCE'] as const;
export type SecurityProfileId = (typeof SECURITY_PROFILES)[number];

export type ControlSimulation = 'implemented' | 'simulated' | 'partial';

export interface SecurityControl {
  key: string;
  label: string;
  /** Non-technical explanation shown next to the control. */
  explanation: string;
  /**
   * How this control behaves in the proof of concept.
   * `implemented` — real code path, `simulated` — demonstration only,
   * `partial` — real logic with a simulated dependency.
   */
  simulation: ControlSimulation;
  simulationNote?: string;
}

export interface SecurityProfile {
  id: SecurityProfileId;
  name: string;
  tagline: string;
  summary: string;
  recommendedFor: string;
  inherits?: SecurityProfileId;
  controls: SecurityControl[];
  /** Machine-readable switches the backend enforces. */
  flags: SecurityProfileFlags;
}

export interface SecurityProfileFlags {
  requireApplicationIdPassword: boolean;
  requireTls: boolean;
  encryptQuestionStorage: boolean;
  signPaperManifest: boolean;
  continuousAnswerSaving: boolean;
  requireRegisteredDevice: boolean;
  requireFaceVerificationAtLogin: boolean;
  singleActiveSession: boolean;
  bindAttemptToDevice: boolean;
  fingerprintVerification: 'off' | 'optional' | 'required';
  periodicFacePresence: boolean;
  livenessChallengeOnAnomaly: boolean;
  invigilatorReviewWorkflow: boolean;
  controlledExamNetwork: boolean;
  ipAllowlist: boolean;
  deviceCertificateRequired: boolean;
  hsmControlledRelease: boolean;
  dualApprovalBeforePublication: boolean;
  immutableAuditEvidence: boolean;
}

const STANDARD_CONTROLS: SecurityControl[] = [
  {
    key: 'appIdPassword',
    label: 'Application ID and password sign-in',
    explanation: 'Each candidate signs in with the application number printed on their admit card and a password.',
    simulation: 'implemented',
  },
  {
    key: 'tls',
    label: 'TLS-protected communication',
    explanation: 'Traffic between the workstation and the examination server is encrypted in transit.',
    simulation: 'partial',
    simulationNote: 'The POC runs over plain HTTP locally. TLS termination is a deployment concern.',
  },
  {
    key: 'encryptedQuestionStorage',
    label: 'Encrypted question storage',
    explanation: 'Keeps the question unreadable until the authorised examination window.',
    simulation: 'implemented',
    simulationNote: 'Real AES-256-GCM. Keys come from a local development key provider, not an HSM.',
  },
  {
    key: 'signedManifest',
    label: 'Signed paper manifest',
    explanation: 'Proof that the approved authority published this exact paper.',
    simulation: 'implemented',
    simulationNote: 'Real Ed25519 signatures over a canonical manifest. Keys are development keys.',
  },
  {
    key: 'continuousSaving',
    label: 'Continuous answer saving',
    explanation: 'Answers are written to the server as soon as they are selected, and again periodically.',
    simulation: 'implemented',
  },
];

const ENHANCED_CONTROLS: SecurityControl[] = [
  {
    key: 'registeredDevice',
    label: 'Registered examination device required',
    explanation: 'Only workstations that the centre has registered and approved can start an attempt.',
    simulation: 'implemented',
  },
  {
    key: 'faceAtLogin',
    label: 'Face verification at login',
    explanation: 'A photograph taken at sign-in is compared with the enrolment photograph on the candidate record.',
    simulation: 'simulated',
    simulationNote: 'POC biometric simulation — no production face-matching engine is used.',
  },
  {
    key: 'singleSession',
    label: 'One active session per candidate',
    explanation: 'A candidate cannot have two live examination sessions at the same time.',
    simulation: 'implemented',
  },
  {
    key: 'attemptBinding',
    label: 'Device and attempt binding',
    explanation: 'An attempt stays tied to the workstation it started on unless staff approve a recovery.',
    simulation: 'implemented',
  },
];

const HIGH_ASSURANCE_CONTROLS: SecurityControl[] = [
  {
    key: 'fingerprint',
    label: 'Optional fingerprint verification',
    explanation: 'An external scanner confirms the candidate’s enrolled fingerprint before the paper is released.',
    simulation: 'simulated',
    simulationNote: 'POC biometric simulation — a scanner adapter with scripted outcomes replaces real hardware.',
  },
  {
    key: 'periodicFace',
    label: 'Periodic face-presence checks',
    explanation: 'The workstation camera confirms at intervals that the candidate is still present and alone.',
    simulation: 'simulated',
    simulationNote: 'Presence results are produced by a mock analyser, not a certified vision service.',
  },
  {
    key: 'liveness',
    label: 'Liveness challenge on anomalies',
    explanation: 'If checks repeatedly fail, the candidate is asked to perform a short live verification.',
    simulation: 'simulated',
    simulationNote:
      'The challenge flow and the escalation around it are real; the liveness decision itself is scripted. Production requires a validated liveness provider.',
  },
  {
    key: 'invigilatorReview',
    label: 'Invigilator review workflow',
    explanation: 'A human reviews flagged sessions. Software never ends an attempt on its own.',
    simulation: 'implemented',
  },
];

const MAXIMUM_ASSURANCE_CONTROLS: SecurityControl[] = [
  {
    key: 'controlledNetwork',
    label: 'Controlled examination network',
    explanation: 'Workstations sit on an isolated examination network with no general internet access.',
    simulation: 'simulated',
    simulationNote: 'Network isolation is an infrastructure control; the POC records the intended policy.',
  },
  {
    key: 'ipAllowlist',
    label: 'IP allowlist',
    explanation:
      'Allows connections only from approved examination-centre networks. It does not replace encryption or candidate verification.',
    simulation: 'implemented',
    simulationNote: 'Enforced against the reported client address, which a demo header can override.',
  },
  {
    key: 'mtls',
    label: 'Device certificate / mTLS',
    explanation: 'A digital identity issued to an approved examination computer, checked before an attempt starts.',
    simulation: 'partial',
    simulationNote: 'Certificate records and expiry are real data; mutual TLS termination is simulated.',
  },
  {
    key: 'hsmRelease',
    label: 'HSM/KMS-controlled question release',
    explanation: 'The key that unlocks the paper is only released inside the authorised examination window.',
    simulation: 'simulated',
    simulationNote: 'A local development key provider stands in for a cloud KMS or hardware security module.',
  },
  {
    key: 'dualApproval',
    label: 'Dual approval before publication',
    explanation: 'Two different authorised people must approve before a paper can be published.',
    simulation: 'implemented',
  },
  {
    key: 'immutableAudit',
    label: 'Immutable audit evidence',
    explanation: 'A history designed so actions cannot be silently rewritten.',
    simulation: 'partial',
    simulationNote: 'Append-only hash-chained application records. Production needs independent WORM storage.',
  },
];

const baseFlags: SecurityProfileFlags = {
  requireApplicationIdPassword: true,
  requireTls: true,
  encryptQuestionStorage: true,
  signPaperManifest: true,
  continuousAnswerSaving: true,
  requireRegisteredDevice: false,
  requireFaceVerificationAtLogin: false,
  singleActiveSession: false,
  bindAttemptToDevice: false,
  fingerprintVerification: 'off',
  periodicFacePresence: false,
  livenessChallengeOnAnomaly: false,
  invigilatorReviewWorkflow: false,
  controlledExamNetwork: false,
  ipAllowlist: false,
  deviceCertificateRequired: false,
  hsmControlledRelease: false,
  dualApprovalBeforePublication: false,
  immutableAuditEvidence: false,
};

const enhancedFlags: SecurityProfileFlags = {
  ...baseFlags,
  requireRegisteredDevice: true,
  requireFaceVerificationAtLogin: true,
  singleActiveSession: true,
  bindAttemptToDevice: true,
};

const highFlags: SecurityProfileFlags = {
  ...enhancedFlags,
  fingerprintVerification: 'optional',
  periodicFacePresence: true,
  livenessChallengeOnAnomaly: true,
  invigilatorReviewWorkflow: true,
};

const maximumFlags: SecurityProfileFlags = {
  ...highFlags,
  controlledExamNetwork: true,
  ipAllowlist: true,
  deviceCertificateRequired: true,
  hsmControlledRelease: true,
  dualApprovalBeforePublication: true,
  immutableAuditEvidence: true,
};

export const SECURITY_PROFILE_DEFINITIONS: Record<SecurityProfileId, SecurityProfile> = {
  STANDARD: {
    id: 'STANDARD',
    name: 'Standard',
    tagline: 'Baseline integrity for low-stakes assessments',
    summary:
      'Protects the paper in storage and in transit, proves who approved it, and keeps answers saved continuously.',
    recommendedFor: 'Internal practice tests and formative assessments.',
    controls: STANDARD_CONTROLS,
    flags: baseFlags,
  },
  ENHANCED: {
    id: 'ENHANCED',
    name: 'Enhanced',
    tagline: 'Adds device trust and identity at sign-in',
    summary:
      'Everything in Standard, plus a registered workstation, a face check at sign-in, and one live session per candidate.',
    recommendedFor: 'Departmental examinations held in managed labs.',
    inherits: 'STANDARD',
    controls: ENHANCED_CONTROLS,
    flags: enhancedFlags,
  },
  HIGH_ASSURANCE: {
    id: 'HIGH_ASSURANCE',
    name: 'High assurance',
    tagline: 'Adds continuous presence checks with human review',
    summary:
      'Everything in Enhanced, plus optional fingerprint verification, periodic presence checks and an invigilator review workflow.',
    recommendedFor: 'Certification examinations with graded outcomes.',
    inherits: 'ENHANCED',
    controls: HIGH_ASSURANCE_CONTROLS,
    flags: highFlags,
  },
  MAXIMUM_ASSURANCE: {
    id: 'MAXIMUM_ASSURANCE',
    name: 'Maximum assurance',
    tagline: 'Controlled premises, controlled network, dual approval',
    summary:
      'Everything in High assurance, plus a controlled examination network, device certificates, key-controlled paper release, dual publication approval and immutable audit evidence.',
    recommendedFor:
      'Recommended for organisation-controlled examination centres where the network, devices and premises are managed by the organisation.',
    inherits: 'HIGH_ASSURANCE',
    controls: MAXIMUM_ASSURANCE_CONTROLS,
    flags: maximumFlags,
  },
};

/** All controls that apply at a profile, including inherited ones. */
export function effectiveControls(id: SecurityProfileId): SecurityControl[] {
  const profile = SECURITY_PROFILE_DEFINITIONS[id];
  const inherited = profile.inherits ? effectiveControls(profile.inherits) : [];
  return [...inherited, ...profile.controls];
}

export function profileFlags(id: SecurityProfileId): SecurityProfileFlags {
  return SECURITY_PROFILE_DEFINITIONS[id].flags;
}
