import { createHash } from 'node:crypto';

/**
 * Wire format for an activation key.
 *
 * A key has to survive being emailed, pasted into a chat window, printed on a
 * sheet and typed back in by a centre moderator under time pressure. So it is
 * plain ASCII, has an obvious prefix, and carries its own version number.
 *
 *   SEPKEY1.<keyring id>.<nonce>.<ciphertext>.<tag>.<signature>
 *
 * The display form breaks that into short lines. Whitespace is insignificant,
 * so a key that survives a word-wrapping email still opens.
 */

export const KEY_PREFIX = 'SEPKEY1';

export interface KeyParts {
  keyId: string;
  nonce: Buffer;
  ciphertext: Buffer;
  authTag: Buffer;
  signature: Buffer;
}

function b64u(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function fromB64u(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

export function encodeKey(parts: KeyParts): string {
  return [KEY_PREFIX, parts.keyId, b64u(parts.nonce), b64u(parts.ciphertext), b64u(parts.authTag), b64u(parts.signature)].join('.');
}

export class MalformedKeyError extends Error {
  override readonly name = 'MalformedKeyError';
  constructor(message: string) {
    super(message);
  }
}

export function decodeKey(input: string): KeyParts {
  const compact = normaliseKey(input);
  if (!compact.startsWith(`${KEY_PREFIX}.`)) {
    throw new MalformedKeyError(
      'That does not look like an examination key. A key begins with SEPKEY1. Check you copied the whole thing.',
    );
  }
  const segments = compact.split('.');
  if (segments.length !== 6) {
    throw new MalformedKeyError('This key is incomplete. Copy it again, including every character to the very end.');
  }
  const [, keyId, nonce, ciphertext, authTag, signature] = segments;
  if (!keyId || !nonce || !ciphertext || !authTag || !signature) {
    throw new MalformedKeyError('This key is incomplete. Copy it again, including every character to the very end.');
  }
  return {
    keyId,
    nonce: fromB64u(nonce),
    ciphertext: fromB64u(ciphertext),
    authTag: fromB64u(authTag),
    signature: fromB64u(signature),
  };
}

/** Strips the whitespace a key picks up from email clients and PDF copy-paste. */
export function normaliseKey(input: string): string {
  return input.replace(/\s+/g, '').trim();
}

/** The bytes a signature covers: everything except the signature itself. */
export function signedBytes(keyId: string, nonce: Buffer, ciphertext: Buffer, authTag: Buffer): Buffer {
  return createHash('sha256')
    .update(`${KEY_PREFIX}.${keyId}.`)
    .update(nonce)
    .update(ciphertext)
    .update(authTag)
    .digest();
}

/** Additional authenticated data, binding the ciphertext to its header. */
export function keyAad(keyId: string): Buffer {
  return Buffer.from(`${KEY_PREFIX}.${keyId}`, 'utf8');
}

/** Short fingerprint quoted in audit records and support calls: 4 groups of 4. */
export function keyFingerprint(key: string): string {
  const digest = createHash('sha256').update(normaliseKey(key)).digest('hex').toUpperCase();
  return (digest.slice(0, 16).match(/.{4}/g) ?? []).join('-');
}

/** Wraps a key at 64 characters so it can be printed or pasted into a form. */
export function toDisplayForm(key: string): string {
  return (normaliseKey(key).match(/.{1,64}/g) ?? []).join('\n');
}
