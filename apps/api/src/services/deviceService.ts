import { randomUUID } from 'node:crypto';
import type {
  CandidateDeviceAssignment,
  DeviceCertificate,
  DeviceAssignmentDecision,
  DeviceEnrolment,
  DeviceFingerprint,
  DeviceMatch,
  ExaminationDevice,
} from '@sep/shared';
import { getDb } from '../lib/store/db.js';
import { evaluateNetwork } from '../lib/network.js';
import { sha256Canonical } from '../lib/crypto/canonical.js';

/**
 * Device identification and candidate association.
 *
 * Auto-detection exists because asking a candidate which machine they are
 * sitting at is a question they have every reason to answer wrongly. The
 * managed Windows application reports hardware identifiers the operating system
 * owns; the server matches those against the device register and says, with an
 * explicit confidence level, which workstation this is.
 *
 * A browser can only supply soft signals. That match is reported as WEAK and is
 * never enough on its own for an examination that requires an assigned device —
 * which is the honest reason a high-assurance examination requires the native
 * client.
 */

const normaliseMac = (mac: string) => mac.trim().toLowerCase().replace(/-/g, ':');

export function issueCertificate(deviceCode: string): DeviceCertificate {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 365 * 86_400_000);
  return {
    serial: randomUUID().slice(0, 17).toUpperCase().replace(/-/g, ':'),
    subject: `CN=${deviceCode}, OU=Examination Workstations, O=Examination Board`,
    issuer: 'CN=Examination Board Device CA, O=Examination Board',
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    status: 'VALID',
    thumbprint: randomUUID().replace(/-/g, '').slice(0, 24),
  };
}

/** Stable identity of a fingerprint, used to spot a machine that changed. */
export function fingerprintDigest(fingerprint: DeviceFingerprint): string {
  return sha256Canonical({
    machineGuid: fingerprint.machineGuid?.toLowerCase() ?? null,
    hostname: fingerprint.hostname?.toLowerCase() ?? null,
    macAddresses: [...fingerprint.macAddresses].map(normaliseMac).sort(),
    serialNumber: fingerprint.serialNumber ?? null,
  });
}

/**
 * Matches a reported fingerprint against the device register.
 *
 * The confidence ladder is deliberate:
 *   EXACT  — the Windows MachineGuid matches. The OS owns this value.
 *   STRONG — hostname plus at least one MAC, or the chassis serial.
 *   WEAK   — soft signals only. A browser cannot identify a machine.
 */
export function matchDevice(fingerprint: DeviceFingerprint): DeviceMatch {
  const db = getDb();
  const enrolments = [...db.deviceEnrolments.values()].filter((e) => e.supersededAt === null);

  const reportedGuid = fingerprint.machineGuid?.trim().toLowerCase() ?? null;
  const reportedHost = fingerprint.hostname?.trim().toLowerCase() ?? null;
  const reportedMacs = new Set(fingerprint.macAddresses.map(normaliseMac).filter(Boolean));
  const reportedSerial = fingerprint.serialNumber?.trim().toLowerCase() ?? null;

  let best: { enrolment: DeviceEnrolment; confidence: DeviceMatch['confidence']; matched: string[]; mismatched: string[] } | null =
    null;

  for (const enrolment of enrolments) {
    const stored = enrolment.fingerprint;
    const storedGuid = stored.machineGuid?.trim().toLowerCase() ?? null;
    const storedHost = stored.hostname?.trim().toLowerCase() ?? null;
    const storedMacs = new Set(stored.macAddresses.map(normaliseMac).filter(Boolean));
    const storedSerial = stored.serialNumber?.trim().toLowerCase() ?? null;

    const matched: string[] = [];
    const mismatched: string[] = [];

    const guidMatch = Boolean(reportedGuid && storedGuid && reportedGuid === storedGuid);
    if (guidMatch) matched.push('machine identifier');
    else if (reportedGuid && storedGuid) mismatched.push('machine identifier');

    const hostMatch = Boolean(reportedHost && storedHost && reportedHost === storedHost);
    if (hostMatch) matched.push('hostname');
    else if (reportedHost && storedHost) mismatched.push('hostname');

    const sharedMacs = [...reportedMacs].filter((mac) => storedMacs.has(mac));
    if (sharedMacs.length > 0) matched.push(`network adapter (${sharedMacs.length})`);
    else if (reportedMacs.size > 0 && storedMacs.size > 0) mismatched.push('network adapter');

    const serialMatch = Boolean(reportedSerial && storedSerial && reportedSerial === storedSerial);
    if (serialMatch) matched.push('chassis serial');
    else if (reportedSerial && storedSerial) mismatched.push('chassis serial');

    let confidence: DeviceMatch['confidence'] = 'NONE';
    if (guidMatch) confidence = 'EXACT';
    else if ((hostMatch && sharedMacs.length > 0) || serialMatch) confidence = 'STRONG';
    else if (hostMatch || sharedMacs.length > 0) confidence = 'WEAK';

    // A browser's signals are never better than weak, whatever they match.
    if (fingerprint.client === 'BROWSER' && confidence !== 'NONE') confidence = 'WEAK';

    if (confidence === 'NONE') continue;

    const rank = { EXACT: 3, STRONG: 2, WEAK: 1, NONE: 0 } as const;
    if (!best || rank[confidence] > rank[best.confidence]) {
      best = { enrolment, confidence, matched, mismatched };
    }
  }

  if (!best) {
    return {
      matched: false,
      deviceId: null,
      deviceCode: null,
      confidence: 'NONE',
      matchedOn: [],
      mismatchedOn: [],
      reason:
        fingerprint.client === 'BROWSER'
          ? 'A web browser cannot identify this machine. Use the managed examination application, or ask the operator to select the workstation manually.'
          : 'This machine does not match any registered workstation. It may not have been enrolled yet.',
      enrolmentRequired: enrolments.length === 0,
    };
  }

  const device = db.devices.get(best.enrolment.deviceId);

  return {
    matched: true,
    deviceId: best.enrolment.deviceId,
    deviceCode: device?.deviceCode ?? null,
    confidence: best.confidence,
    matchedOn: best.matched,
    mismatchedOn: best.mismatched,
    reason:
      best.confidence === 'EXACT'
        ? `Identified as ${device?.deviceCode ?? 'a registered workstation'} from the machine identifier reported by Windows.`
        : best.confidence === 'STRONG'
          ? `Identified as ${device?.deviceCode ?? 'a registered workstation'} from ${best.matched.join(' and ')}.`
          : `Possibly ${device?.deviceCode ?? 'a registered workstation'}, matched only on ${best.matched.join(' and ')}. This is not a reliable identification.`,
    enrolmentRequired: false,
  };
}

/** Records a fingerprint against a workstation, superseding any earlier one. */
export function enrolDevice(input: {
  deviceId: string;
  fingerprint: DeviceFingerprint;
  userId: string;
  notes: string;
}): DeviceEnrolment {
  const db = getDb();
  const now = new Date().toISOString();

  [...db.deviceEnrolments.values()]
    .filter((e) => e.deviceId === input.deviceId && e.supersededAt === null)
    .forEach((e) => {
      e.supersededAt = now;
    });

  const enrolment: DeviceEnrolment = {
    id: randomUUID(),
    deviceId: input.deviceId,
    fingerprint: input.fingerprint,
    enrolledByUserId: input.userId,
    enrolledAt: now,
    supersededAt: null,
    notes: input.notes,
  };
  db.deviceEnrolments.set(enrolment.id, enrolment);

  const device = db.devices.get(input.deviceId);
  if (device) {
    if (input.fingerprint.operatingSystem) device.operatingSystem = input.fingerprint.operatingSystem;
    if (input.fingerprint.localIpAddress) device.ipAddress = input.fingerprint.localIpAddress;
    device.lastHealthCheckAt = now;
  }

  return enrolment;
}

/* ------------------------------------------------------------------ */
/* Candidate association                                               */
/* ------------------------------------------------------------------ */

export function assignmentFor(examId: string, candidateId: string): CandidateDeviceAssignment | null {
  const db = getDb();
  return (
    [...db.deviceAssignments.values()].find(
      (a) => a.examId === examId && a.candidateId === candidateId && a.releasedAt === null,
    ) ?? null
  );
}

/**
 * Decides whether this candidate may sit at this workstation.
 *
 * Seat allocation with teeth: a candidate assigned to WS-CEC-014 cannot start on
 * WS-CEC-015, even though both are approved workstations at the same centre.
 * Staff can release the binding when a machine genuinely fails, which is
 * recorded with a reason.
 */
export function evaluateDeviceAssignment(input: {
  examId: string;
  candidateId: string;
  device: ExaminationDevice | undefined;
  enforce: boolean;
}): DeviceAssignmentDecision {
  const { examId, candidateId, device, enforce } = input;
  const assignment = assignmentFor(examId, candidateId);

  if (!enforce) {
    return {
      allowed: true,
      reason: 'This examination does not bind candidates to a specific workstation.',
      guidance: '',
      assignment,
      expectedDeviceCode: assignment?.deviceCode ?? null,
      actualDeviceCode: device?.deviceCode ?? null,
    };
  }

  if (!assignment) {
    return {
      allowed: false,
      reason: 'No workstation has been assigned to this candidate for this examination.',
      guidance:
        'The examination requires an assigned seat. Ask the examination-centre operator to allocate one before continuing.',
      assignment: null,
      expectedDeviceCode: null,
      actualDeviceCode: device?.deviceCode ?? null,
    };
  }

  if (assignment.allowAnyApprovedDevice || !assignment.deviceId) {
    return {
      allowed: true,
      reason: 'This candidate may use any approved workstation at the centre.',
      guidance: '',
      assignment,
      expectedDeviceCode: null,
      actualDeviceCode: device?.deviceCode ?? null,
    };
  }

  if (!device) {
    return {
      allowed: false,
      reason: 'This workstation could not be identified, so the seat assignment cannot be checked.',
      guidance: 'Ask the examination-centre operator to identify this machine before continuing.',
      assignment,
      expectedDeviceCode: assignment.deviceCode,
      actualDeviceCode: null,
    };
  }

  if (device.id !== assignment.deviceId) {
    return {
      allowed: false,
      reason: `This candidate is assigned to ${assignment.deviceCode ?? 'another workstation'} but is at ${device.deviceCode}.`,
      guidance:
        'Move to the assigned workstation, or ask an invigilator to release the seat assignment. Any answers already saved are safe.',
      assignment,
      expectedDeviceCode: assignment.deviceCode,
      actualDeviceCode: device.deviceCode,
    };
  }

  return {
    allowed: true,
    reason: `Seated at the assigned workstation ${device.deviceCode}.`,
    guidance: '',
    assignment,
    expectedDeviceCode: assignment.deviceCode,
    actualDeviceCode: device.deviceCode,
  };
}

/**
 * Network ranges for a candidate: their own overrides if set, otherwise the
 * examination's. Per-candidate ranges let a centre run one hall on a separate
 * VLAN without loosening the policy for everyone.
 */
export function allowedRangesFor(input: {
  examId: string;
  candidateId: string;
  examPrimary: string;
  examBackup?: string | null;
  examIpv6?: string | null;
}): string[] {
  const assignment = assignmentFor(input.examId, input.candidateId);
  if (assignment && assignment.allowedCidrs.length > 0) return assignment.allowedCidrs;
  return [input.examPrimary, input.examBackup, input.examIpv6].filter((r): r is string => Boolean(r));
}

export function evaluateCandidateNetwork(input: {
  examId: string;
  candidateId: string;
  ipAddress: string;
  examPrimary: string;
  examBackup?: string | null;
  examIpv6?: string | null;
  enforce: boolean;
}) {
  const ranges = allowedRangesFor(input);
  return { ...evaluateNetwork(input.ipAddress, ranges, input.enforce), ranges };
}

/** Upserts a candidate-to-workstation binding. */
export function upsertAssignment(input: {
  examId: string;
  candidateId: string;
  candidateApplicationId: string;
  candidateName: string;
  deviceId: string | null;
  seatNumber: string;
  allowedCidrs: string[];
  allowAnyApprovedDevice: boolean;
}): CandidateDeviceAssignment {
  const db = getDb();
  const now = new Date().toISOString();
  const device = input.deviceId ? db.devices.get(input.deviceId) : undefined;

  const existing = [...db.deviceAssignments.values()].find(
    (a) => a.examId === input.examId && a.candidateId === input.candidateId && a.releasedAt === null,
  );

  if (existing) {
    existing.deviceId = input.deviceId;
    existing.deviceCode = device?.deviceCode ?? null;
    existing.seatNumber = input.seatNumber || existing.seatNumber;
    existing.allowedCidrs = input.allowedCidrs;
    existing.allowAnyApprovedDevice = input.allowAnyApprovedDevice;
    existing.updatedAt = now;
    return existing;
  }

  const assignment: CandidateDeviceAssignment = {
    id: randomUUID(),
    examId: input.examId,
    candidateId: input.candidateId,
    candidateApplicationId: input.candidateApplicationId,
    candidateName: input.candidateName,
    deviceId: input.deviceId,
    deviceCode: device?.deviceCode ?? null,
    seatNumber: input.seatNumber,
    allowedCidrs: input.allowedCidrs,
    allowAnyApprovedDevice: input.allowAnyApprovedDevice,
    releasedByUserId: null,
    releasedAt: null,
    releaseReason: null,
    createdAt: now,
    updatedAt: now,
  };
  db.deviceAssignments.set(assignment.id, assignment);
  return assignment;
}

/** Builds a fingerprint from request headers when no client supplied one. */
export function fingerprintFromRequest(headers: Record<string, string | string[] | undefined>): DeviceFingerprint {
  const header = (name: string) => {
    const value = headers[name];
    return typeof value === 'string' ? value : null;
  };
  return {
    machineGuid: header('x-device-machine-guid'),
    hostname: header('x-device-hostname'),
    macAddresses: (header('x-device-mac') ?? '').split(',').map((m) => m.trim()).filter(Boolean),
    serialNumber: header('x-device-serial'),
    operatingSystem: header('x-device-os'),
    cpuSignature: null,
    totalMemoryMb: null,
    displayCount: null,
    primaryResolution: null,
    localIpAddress: null,
    client: header('x-exam-client') === 'windows-native' ? 'WINDOWS_NATIVE' : 'BROWSER',
    clientVersion: header('x-exam-client-version'),
    userAgent: header('user-agent'),
    timeZone: null,
    applicationSignatureValid: null,
    capturedAt: new Date().toISOString(),
  };
}
