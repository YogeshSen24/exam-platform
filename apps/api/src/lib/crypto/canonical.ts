import { createHash } from 'node:crypto';

/**
 * Deterministic canonical JSON.
 *
 * Two structurally identical objects must always produce identical bytes,
 * otherwise a hash is meaningless as an integrity check. Keys are sorted,
 * undefined is dropped, and no incidental whitespace is emitted.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortValue);
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (record[key] === undefined) continue;
    out[key] = sortValue(record[key]);
  }
  return out;
}

/** SHA-256 over canonical JSON, hex encoded. */
export function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Short display form used throughout the UI: 1a2b3c4d…9f8e7d6c */
export function shortHash(hash: string): string {
  if (hash.length <= 20) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`;
}
