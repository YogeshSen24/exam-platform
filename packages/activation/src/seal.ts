import { createCipheriv, createDecipheriv, randomBytes, sign as edSign, verify as edVerify } from 'node:crypto';
import type { DeploymentKeyring } from './deployment.js';
import { decodeKey, encodeKey, keyAad, keyFingerprint, signedBytes, MalformedKeyError } from './format.js';
import type { ActivationPayload, OpenedKey } from './types.js';

/**
 * Sealing and opening.
 *
 *   seal:  rules -> canonical JSON -> AES-256-GCM -> Ed25519 signature -> text
 *   open:  text -> signature check -> AES-256-GCM -> rules
 *
 * The signature is checked *before* decryption, so a forged key is rejected
 * without its contents ever being processed.
 */

/** Deterministic JSON, so the same rules always produce the same bytes. */
function canonical(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortDeep);
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (record[key] === undefined) continue;
    out[key] = sortDeep(record[key]);
  }
  return out;
}

export function sealActivationKey(payload: ActivationPayload, keyring: DeploymentKeyring): string {
  if (!keyring.signingKey) {
    throw new Error('This keyring cannot issue keys. Only the central server holds the deployment secret.');
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyring.contentKey, nonce);
  cipher.setAAD(keyAad(keyring.keyId));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(canonical(payload), 'utf8')), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const signature = edSign(null, signedBytes(keyring.keyId, nonce, ciphertext, authTag), keyring.signingKey);

  return encodeKey({ keyId: keyring.keyId, nonce, ciphertext, authTag, signature });
}

export class InvalidKeyError extends Error {
  override readonly name = 'InvalidKeyError';
  /** Plain-language next step, shown directly to a centre moderator. */
  readonly remedy: string;
  constructor(message: string, remedy: string) {
    super(message);
    this.remedy = remedy;
  }
}

/**
 * Opens a key and proves it was issued by this deployment.
 *
 * This checks authenticity only. Whether the key is *usable here and now* is a
 * separate question, answered by `validateActivation`.
 */
export function openActivationKey(keyText: string, keyring: DeploymentKeyring): OpenedKey {
  let parts;
  try {
    parts = decodeKey(keyText);
  } catch (error) {
    if (error instanceof MalformedKeyError) {
      throw new InvalidKeyError(error.message, 'Ask the examination board to send the key again.');
    }
    throw error;
  }

  if (parts.keyId !== keyring.keyId) {
    throw new InvalidKeyError(
      'This key was issued for a different examination board.',
      'Check you were sent the key for this examination system, not another board.',
    );
  }

  const authentic = edVerify(
    null,
    signedBytes(parts.keyId, parts.nonce, parts.ciphertext, parts.authTag),
    keyring.verifyKey,
    parts.signature,
  );
  if (!authentic) {
    throw new InvalidKeyError(
      'This key is not genuine. Its signature does not match the examination board.',
      'Do not use it. Contact the examination board, because a key that fails this check has been altered or fabricated.',
    );
  }

  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyring.contentKey, parts.nonce);
    decipher.setAAD(keyAad(parts.keyId));
    decipher.setAuthTag(parts.authTag);
    plaintext = Buffer.concat([decipher.update(parts.ciphertext), decipher.final()]);
  } catch {
    throw new InvalidKeyError(
      'This key is damaged and cannot be read.',
      'Copy the key again from the original message, taking care to include every character.',
    );
  }

  const payload = JSON.parse(plaintext.toString('utf8')) as ActivationPayload;
  if (payload.formatVersion !== 1) {
    throw new InvalidKeyError(
      `This key uses format version ${payload.formatVersion}, which this system does not understand.`,
      'Ask the examination board for a key in the format this system supports.',
    );
  }

  return { payload, keyFingerprint: keyFingerprint(keyText) };
}

export interface ValidationContext {
  now: Date;
  /** The board this server belongs to. A key from another board is refused. */
  deploymentId: string;
}

export interface ValidationProblem {
  message: string;
  remedy: string;
}

/**
 * Decides whether an authentic key may be used on *this* machine *now*.
 *
 * Separated from opening so the setup screen can show a moderator what the key
 * contains even when it cannot be used yet. "This is the right key, but it is
 * for next Tuesday" is a far more useful message than a flat refusal.
 */
export function validateActivation(payload: ActivationPayload, context: ValidationContext): ValidationProblem | null {
  if (payload.deploymentId !== context.deploymentId) {
    return {
      message: 'This key belongs to a different examination board.',
      remedy: 'Use the key issued by the board that runs this system.',
    };
  }

  const expiresAt = new Date(payload.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    return { message: 'This key has no readable expiry date.', remedy: 'Ask the examination board to reissue it.' };
  }
  if (expiresAt.getTime() <= context.now.getTime()) {
    return {
      message: `This key expired on ${expiresAt.toUTCString()}.`,
      remedy: 'Ask the examination board to issue a fresh key for this centre.',
    };
  }

  const closesAt = new Date(payload.window.closesAt);
  if (!Number.isNaN(closesAt.getTime()) && closesAt.getTime() <= context.now.getTime()) {
    return {
      message: 'The examination window for this key has already closed.',
      remedy: 'Check the examination date. If it is correct, ask the board for a key covering the new window.',
    };
  }

  const quotaTotal = payload.rules.delivery.quotas.reduce((sum, q) => sum + q.deliver, 0);
  if (quotaTotal !== payload.rules.delivery.totalDelivered) {
    return {
      message: 'The question allocation inside this key is inconsistent.',
      remedy: 'Do not use it. Ask the examination board to reissue the key.',
    };
  }
  const shortPool = payload.rules.delivery.quotas.find((q) => q.poolSize < q.deliver);
  if (shortPool) {
    return {
      message: `Category ${shortPool.categoryCode} promises ${shortPool.deliver} questions from a pool of only ${shortPool.poolSize}.`,
      remedy: 'Do not use it. Ask the examination board to reissue the key.',
    };
  }

  return null;
}

/** True once candidates may start, and not after the window has closed. */
export function releaseWindowOpen(payload: ActivationPayload, now: Date = new Date()): boolean {
  const opens = new Date(payload.window.opensAt).getTime();
  const closes = new Date(payload.window.closesAt).getTime();
  return now.getTime() >= opens && now.getTime() <= closes;
}
