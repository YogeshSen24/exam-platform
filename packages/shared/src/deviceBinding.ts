import type { ISODateString } from './types.js';

/**
 * Device identity, auto-detection and candidate association.
 *
 * A workstation is identified by a **hardware fingerprint** the managed Windows
 * application reports, not by a code the candidate types. Asking a candidate
 * which machine they are sitting at is a question they have every reason to
 * answer wrongly; deriving it from the machine is not.
 */

/**
 * What the client reports about the machine it is running on.
 *
 * The native Windows application supplies real values from the operating
 * system. A browser can supply only the soft signals, which is precisely why a
 * browser cannot be trusted as an examination client — and why an examination
 * can require the native client.
 */
export interface DeviceFingerprint {
  /** Windows MachineGuid from the registry. Stable across reboots and logins. */
  machineGuid: string | null;
  /** Machine hostname as the domain sees it. */
  hostname: string | null;
  /** MAC addresses of physical adapters, sorted, lower case. */
  macAddresses: string[];
  /** Motherboard or chassis serial, where the OS exposes it. */
  serialNumber: string | null;
  /** Operating system name and build. */
  operatingSystem: string | null;
  /** CPU model and logical core count, as a coarse hardware signal. */
  cpuSignature: string | null;
  /** Total physical memory in MB, rounded. */
  totalMemoryMb: number | null;
  /** Number of attached displays. More than one is worth an invigilator's attention. */
  displayCount: number | null;
  /** Primary display resolution, e.g. "1920x1080". */
  primaryResolution: string | null;
  /** Locally observed IPv4 address of the examination adapter. */
  localIpAddress: string | null;
  /** Which client produced this fingerprint. */
  client: DeviceClientKind;
  /** Version of the examination application. */
  clientVersion: string | null;
  /** Soft browser signals, only meaningful for the browser fallback. */
  userAgent: string | null;
  timeZone: string | null;
  /** Set by the native shell once it has verified its own signature. */
  applicationSignatureValid: boolean | null;
  capturedAt: ISODateString;
}

export type DeviceClientKind = 'WINDOWS_NATIVE' | 'BROWSER' | 'UNKNOWN';

/**
 * The result of matching a reported fingerprint against the device register.
 *
 * `confidence` is deliberately explicit. A machine GUID match is near-certain; a
 * match on hostname plus MAC is strong; a browser fingerprint is weak and the
 * interface says so rather than implying it identified the machine.
 */
export interface DeviceMatch {
  matched: boolean;
  deviceId: string | null;
  deviceCode: string | null;
  confidence: 'EXACT' | 'STRONG' | 'WEAK' | 'NONE';
  /** Which signals actually matched, for the audit record and the operator. */
  matchedOn: string[];
  /** Signals that were expected but differed — a swapped network card, say. */
  mismatchedOn: string[];
  reason: string;
  /** True when the register holds no fingerprint for this device yet. */
  enrolmentRequired: boolean;
}

/** A fingerprint recorded against a registered workstation. */
export interface DeviceEnrolment {
  id: string;
  deviceId: string;
  fingerprint: DeviceFingerprint;
  enrolledByUserId: string;
  enrolledAt: ISODateString;
  /** Set when the hardware changed and the enrolment was re-recorded. */
  supersededAt: ISODateString | null;
  notes: string;
}

/**
 * Binds a candidate to the workstation and network they are permitted to use.
 *
 * This is the "device access with association with the candidate" control: seat
 * allocation with teeth. A candidate assigned to WS-CEC-014 cannot start on
 * WS-CEC-015, even though both are approved workstations at the same centre.
 */
export interface CandidateDeviceAssignment {
  id: string;
  examId: string;
  candidateId: string;
  candidateApplicationId: string;
  candidateName: string;
  deviceId: string | null;
  deviceCode: string | null;
  seatNumber: string;
  /** Network ranges this candidate may connect from. Empty means the exam's ranges. */
  allowedCidrs: string[];
  /** Permit any approved workstation at the centre instead of a specific one. */
  allowAnyApprovedDevice: boolean;
  /** Staff may release the binding so a candidate can be moved after a fault. */
  releasedByUserId: string | null;
  releasedAt: ISODateString | null;
  releaseReason: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface DeviceAssignmentDecision {
  allowed: boolean;
  reason: string;
  guidance: string;
  assignment: CandidateDeviceAssignment | null;
  expectedDeviceCode: string | null;
  actualDeviceCode: string | null;
}

/** Human-readable explanation of each confidence level, for the interface. */
export const MATCH_CONFIDENCE_EXPLANATION: Record<DeviceMatch['confidence'], string> = {
  EXACT:
    'The machine identifier reported by the operating system matches the registered workstation exactly.',
  STRONG:
    'Several hardware signals match the registered workstation, though the machine identifier was not available.',
  WEAK:
    'Only soft signals matched. A browser cannot identify a machine reliably — treat this as unverified.',
  NONE: 'Nothing about this machine matches a registered workstation.',
};
