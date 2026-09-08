import type { ISODateString } from './types.js';

/**
 * Provisioning: the keys a board issues, and the machines that redeem them.
 *
 * A board runs several examinations at once. A key is how a machine is told
 * which one it is running, and the record of that machine is how a result is
 * later traced back to a room, a sitting and a station.
 *
 * A key that has left the building is a liability, so every one is recorded
 * here. None of these records contain a key, only its fingerprint, so the
 * register is safe to display.
 */

export type ActivationKeyStatus = 'ISSUED' | 'ACTIVATED' | 'REVOKED' | 'EXPIRED';

export interface ActivationKeyRecord {
  id: string;
  /** Fingerprint of the issued key. The key itself is never stored. */
  fingerprint: string;
  examId: string;
  examCode: string;
  examName: string;
  centreId: string;
  centreCode: string;
  centreName: string;
  status: ActivationKeyStatus;
  issuedAt: ISODateString;
  issuedByUserId: string;
  issuedByName: string;
  expiresAt: ISODateString;
  /** First machine to redeem this key, and when. */
  activatedAt: ISODateString | null;
  activatedByStation: string | null;
  /** How many machines this key may set up, and how many it has. */
  maxStations: number;
  activationCount: number;
  revokedAt: ISODateString | null;
  revokedByUserId: string | null;
  revokedReason: string | null;
  /** Room, sitting and any tags the board attached. Carried onto every result. */
  room: string;
  session: string;
  tags: Record<string, string>;
  note: string;
}

/**
 * A machine set up with a key.
 *
 * Created when a key is redeemed, and named on every attempt started there, so
 * a result can always be traced back to the machine a candidate sat at.
 */
export interface StationRecord {
  id: string;
  /** Short, readable code shown to invigilators: DEL-01-R4-03. */
  code: string;
  activationKeyId: string;
  examId: string;
  centreId: string;
  centreCode: string;
  room: string;
  session: string;
  tags: Record<string, string>;
  redeemedAt: ISODateString;
  /**
   * When this machine stops being set up and has to be keyed again.
   *
   * Deliberately short. A machine left configured overnight is a machine
   * anyone can walk up to in the morning and start an examination on, so the
   * setup lapses on its own rather than relying on somebody remembering to
   * clear it.
   */
  expiresAt: ISODateString;
  lastSeenAt: ISODateString;
  ipAddress: string;
  userAgent: string;
  status: 'ACTIVE' | 'RETIRED';
  /** Attempts started at this machine. */
  attemptCount: number;
}

/**
 * Everything recorded alongside an attempt about where it happened.
 *
 * The point of the whole provisioning chain: an answer is not just an answer,
 * it is this candidate's answer, to this examination, at this centre, in this
 * room, at this sitting, on this machine. Marking, invalidation and appeals all
 * depend on being able to say that afterwards.
 */
export interface AttemptProvenance {
  stationId: string;
  stationCode: string;
  activationKeyId: string;
  centreId: string;
  centreCode: string;
  room: string;
  session: string;
  tags: Record<string, string>;
}
