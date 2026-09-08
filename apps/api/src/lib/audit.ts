import { randomUUID } from 'node:crypto';
import type { AuditAction, AuditEvent, Role } from '@sep/shared';
import { sha256Canonical } from './crypto/canonical.js';
import { getDb } from './store/db.js';

/**
 * Append-only, hash-chained audit trail.
 *
 * Each entry carries the hash of the entry before it. Editing or removing any
 * entry breaks every hash after it, so tampering is detectable. There is
 * deliberately no update or delete function in this module, and no route exposes
 * one — an administrator cannot edit an audit event through the application.
 *
 * POC boundary: a production system additionally writes this chain to
 * independent immutable/WORM storage so the application cannot rewrite history
 * by replacing its own database.
 */

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditInput {
  actorId: string;
  actorName: string;
  actorRole: Role | 'SYSTEM';
  action: AuditAction;
  targetType: string;
  targetId: string;
  targetLabel: string;
  result?: 'SUCCESS' | 'FAILURE' | 'BLOCKED';
  reason: string;
  deviceId?: string | null;
  ipAddress?: string;
  traceId?: string;
  /** Overrides the timestamp when seeding historical demo data. */
  timestamp?: string;
}

export function recordAudit(input: AuditInput): AuditEvent {
  const db = getDb();
  const previous = db.auditEvents[db.auditEvents.length - 1];
  const previousHash = previous ? previous.hash : GENESIS_HASH;
  const sequence = ++db.counters.auditSequence;

  const body = {
    sequence,
    timestamp: input.timestamp ?? new Date().toISOString(),
    actorId: input.actorId,
    actorName: input.actorName,
    actorRole: input.actorRole,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    targetLabel: input.targetLabel,
    result: input.result ?? 'SUCCESS',
    reason: input.reason,
    deviceId: input.deviceId ?? null,
    ipAddress: input.ipAddress ?? 'unknown',
    traceId: input.traceId ?? randomUUID(),
    previousHash,
  };

  const event: AuditEvent = {
    id: randomUUID(),
    ...body,
    hash: sha256Canonical(body),
  };

  db.auditEvents.push(event);
  return event;
}

export interface ChainVerification {
  intact: boolean;
  checkedEvents: number;
  brokenAtSequence: number | null;
  message: string;
}

/** Recomputes the whole chain — used by the audit report view. */
export function verifyAuditChain(): ChainVerification {
  const db = getDb();
  let previousHash = GENESIS_HASH;

  for (const event of db.auditEvents) {
    const { id, hash, ...body } = event;
    void id;
    if (body.previousHash !== previousHash) {
      return {
        intact: false,
        checkedEvents: db.auditEvents.length,
        brokenAtSequence: event.sequence,
        message: `The link before event ${event.sequence} does not match. The history may have been altered.`,
      };
    }
    if (sha256Canonical(body) !== hash) {
      return {
        intact: false,
        checkedEvents: db.auditEvents.length,
        brokenAtSequence: event.sequence,
        message: `Event ${event.sequence} does not match its own fingerprint. The record may have been altered.`,
      };
    }
    previousHash = hash;
  }

  return {
    intact: true,
    checkedEvents: db.auditEvents.length,
    brokenAtSequence: null,
    message: `All ${db.auditEvents.length} entries link correctly to the entry before them.`,
  };
}

/** The hash of the most recent event — anchored into submission receipts. */
export function currentAnchorHash(): string {
  const db = getDb();
  return db.auditEvents[db.auditEvents.length - 1]?.hash ?? GENESIS_HASH;
}
