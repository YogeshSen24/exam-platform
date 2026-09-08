import { createHash, createPrivateKey, createPublicKey, hkdfSync, type KeyObject } from 'node:crypto';

/**
 * Deployment keyring.
 *
 * One examination board is one "deployment". Everything an activation key
 * needs is derived from a single deployment secret, so there is exactly one
 * secret to protect rather than a drawer full of them.
 *
 *   deployment secret ──┬── content key   (AES-256-GCM, makes a key opaque)
 *                       └── signing seed  (Ed25519, makes a key unforgeable)
 *
 * The central server holds the secret and can therefore *issue* keys.
 * The installers ship with the derived content key and the *public* half of
 * the signing key, so they can open and authenticate a key but can never mint
 * one. Extracting an installer yields the ability to read a key, not to forge
 * one, and reading a key still yields no question content.
 */

const CONTENT_INFO = 'sep/activation/content/v1';
const SIGNING_INFO = 'sep/activation/signing/v1';
const SALT = 'sep-activation-v1';

/** PKCS#8 wrapper for a raw 32-byte Ed25519 seed. */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
/** SubjectPublicKeyInfo wrapper for a raw 32-byte Ed25519 public key. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export interface DeploymentKeyring {
  deploymentId: string;
  /** Short public identifier printed inside every key, so a machine knows which keyring to use. */
  keyId: string;
  contentKey: Buffer;
  /** Present only where the deployment secret is known — that is, on the central server. */
  signingKey: KeyObject | null;
  verifyKey: KeyObject;
  /** Everything an installer needs to open and check keys, and nothing more. */
  publicMaterial: DeploymentPublicMaterial;
}

/** The bundle baked into an installer at build time. */
export interface DeploymentPublicMaterial {
  deploymentId: string;
  keyId: string;
  contentKeyBase64: string;
  verifyKeyBase64: string;
}

function derive(secret: string, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from(SALT, 'utf8'), Buffer.from(info, 'utf8'), 32));
}

function privateKeyFromSeed(seed: Buffer): KeyObject {
  return createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
}

export function publicKeyFromRaw(raw: Buffer): KeyObject {
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

/** Raw 32-byte public key, which is the compact form we ship and fingerprint. */
export function rawPublicKey(key: KeyObject): Buffer {
  return key.export({ format: 'der', type: 'spki' }).subarray(ED25519_SPKI_PREFIX.length);
}

/** Issuer-side keyring. Requires the deployment secret. */
export function keyringFromSecret(deploymentId: string, secret: string): DeploymentKeyring {
  if (secret.length < 32) {
    throw new Error('The deployment secret must be at least 32 characters.');
  }
  const contentKey = derive(secret, CONTENT_INFO);
  const signingKey = privateKeyFromSeed(derive(secret, SIGNING_INFO));
  const verifyKey = createPublicKey(signingKey);
  const verifyRaw = rawPublicKey(verifyKey);
  const keyId = createHash('sha256').update(deploymentId).update(verifyRaw).digest('hex').slice(0, 12);

  return {
    deploymentId,
    keyId,
    contentKey,
    signingKey,
    verifyKey,
    publicMaterial: {
      deploymentId,
      keyId,
      contentKeyBase64: contentKey.toString('base64'),
      verifyKeyBase64: verifyRaw.toString('base64'),
    },
  };
}

/** Installer-side keyring. Can open and verify; cannot sign. */
export function keyringFromPublicMaterial(material: DeploymentPublicMaterial): DeploymentKeyring {
  const contentKey = Buffer.from(material.contentKeyBase64, 'base64');
  if (contentKey.length !== 32) {
    throw new Error('The embedded content key is malformed.');
  }
  const verifyKey = publicKeyFromRaw(Buffer.from(material.verifyKeyBase64, 'base64'));
  return {
    deploymentId: material.deploymentId,
    keyId: material.keyId,
    contentKey,
    signingKey: null,
    verifyKey,
    publicMaterial: material,
  };
}

/** Stable fingerprint of a deployment's signing key, shown in support screens. */
export function signingFingerprint(keyring: DeploymentKeyring): string {
  return createHash('sha256').update(rawPublicKey(keyring.verifyKey)).digest('hex');
}
