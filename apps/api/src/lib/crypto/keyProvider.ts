import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  sign as nodeSign,
  verify as nodeVerify,
  type KeyObject,
} from 'node:crypto';
import { env } from '../../config/env.js';

/**
 * Key management abstraction.
 *
 * The POC ships a `LocalDevelopmentKeyProvider` that generates ephemeral keys
 * in process memory. Production deployments are expected to implement
 * `CloudKmsProvider` against a cloud KMS or a dedicated HSM so that private key
 * material never enters the application process.
 *
 * Encryption keys and signing keys are deliberately separate.
 */

export interface DataKey {
  /** Opaque reference recorded in the manifest — never the key itself. */
  reference: string;
  /** Plaintext key material, only present in the local development provider. */
  plaintext: Buffer;
}

export interface EncryptedEnvelope {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyReference: string;
  algorithm: 'AES-256-GCM';
}

export interface KeyManagementProvider {
  readonly kind: 'local-development' | 'cloud-kms';
  readonly productionReady: boolean;
  readonly displayName: string;
  readonly signingKeyReference: string;
  readonly signatureAlgorithm: string;

  /** Creates a fresh random data-encryption key for a single exam paper. */
  generateDataKey(purpose: string): Promise<DataKey>;
  encrypt(key: DataKey, plaintext: Buffer, aad: Buffer): Promise<EncryptedEnvelope>;
  decrypt(key: DataKey, envelope: EncryptedEnvelope, aad: Buffer): Promise<Buffer>;
  sign(payload: Buffer): Promise<string>;
  verify(payload: Buffer, signatureBase64: string): Promise<boolean>;
  publicKeyPem(): string;
  /** Resolves a previously issued data key. Gated by the release window. */
  resolveDataKey(reference: string): Promise<DataKey | null>;
  /** Set by the release policy: whether the key may be released right now. */
  describe(): KeyProviderDescription;
}

export interface KeyProviderDescription {
  kind: string;
  displayName: string;
  productionReady: boolean;
  signatureAlgorithm: string;
  encryptionAlgorithm: string;
  keyRotation: string;
  warning: string | null;
}

/* ------------------------------------------------------------------ */
/* Local development provider                                          */
/* ------------------------------------------------------------------ */

export class LocalDevelopmentKeyProvider implements KeyManagementProvider {
  readonly kind = 'local-development' as const;
  readonly productionReady = false;
  readonly displayName = 'Local development key provider (simulated KMS/HSM)';
  readonly signatureAlgorithm = 'Ed25519';
  readonly signingKeyReference: string;

  #signingKey: KeyObject;
  #verifyKey: KeyObject;
  #dataKeys = new Map<string, Buffer>();

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    this.#signingKey = privateKey;
    this.#verifyKey = publicKey;
    this.signingKeyReference = `dev-signing-key/ed25519/${randomBytes(4).toString('hex')}`;
  }

  async generateDataKey(purpose: string): Promise<DataKey> {
    const plaintext = randomBytes(32); // AES-256
    const reference = `dev-data-key/${purpose}/${randomBytes(6).toString('hex')}`;
    this.#dataKeys.set(reference, plaintext);
    return { reference, plaintext };
  }

  async resolveDataKey(reference: string): Promise<DataKey | null> {
    const plaintext = this.#dataKeys.get(reference);
    return plaintext ? { reference, plaintext } : null;
  }

  async encrypt(key: DataKey, plaintext: Buffer, aad: Buffer): Promise<EncryptedEnvelope> {
    // A unique nonce for every encryption operation is mandatory for GCM.
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key.plaintext, nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      ciphertext,
      nonce,
      authTag: cipher.getAuthTag(),
      keyReference: key.reference,
      algorithm: 'AES-256-GCM',
    };
  }

  async decrypt(key: DataKey, envelope: EncryptedEnvelope, aad: Buffer): Promise<Buffer> {
    const decipher = createDecipheriv('aes-256-gcm', key.plaintext, envelope.nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(envelope.authTag);
    return Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
  }

  async sign(payload: Buffer): Promise<string> {
    return nodeSign(null, payload, this.#signingKey).toString('base64');
  }

  async verify(payload: Buffer, signatureBase64: string): Promise<boolean> {
    try {
      return nodeVerify(null, payload, this.#verifyKey, Buffer.from(signatureBase64, 'base64'));
    } catch {
      return false;
    }
  }

  publicKeyPem(): string {
    return this.#verifyKey.export({ type: 'spki', format: 'pem' }).toString();
  }

  describe(): KeyProviderDescription {
    return {
      kind: this.kind,
      displayName: this.displayName,
      productionReady: false,
      signatureAlgorithm: 'Ed25519',
      encryptionAlgorithm: 'AES-256-GCM',
      keyRotation: 'Ephemeral — regenerated on every process start',
      warning:
        'Development keys live in application memory and are recreated on restart. They are not suitable for production. A production deployment must use a cloud KMS or a dedicated HSM.',
    };
  }
}

/* ------------------------------------------------------------------ */
/* Cloud KMS placeholder                                               */
/* ------------------------------------------------------------------ */

/**
 * Placeholder for a production key provider. Left unimplemented on purpose:
 * the POC must not give the impression that a managed KMS or HSM is wired up.
 */
export class CloudKmsProvider implements KeyManagementProvider {
  readonly kind = 'cloud-kms' as const;
  readonly productionReady = true;
  readonly displayName = 'Cloud KMS / HSM provider (not implemented in this POC)';
  readonly signatureAlgorithm = 'Provider-defined';
  readonly signingKeyReference = env.KMS_KEY_ID ?? 'kms://not-configured';

  #notImplemented(operation: string): never {
    throw new Error(
      `CloudKmsProvider.${operation} is not implemented in this proof of concept. ` +
        'Integrate a cloud KMS or HSM before enabling KEY_PROVIDER=kms.',
    );
  }

  async generateDataKey(): Promise<DataKey> {
    this.#notImplemented('generateDataKey');
  }
  async resolveDataKey(): Promise<DataKey | null> {
    this.#notImplemented('resolveDataKey');
  }
  async encrypt(): Promise<EncryptedEnvelope> {
    this.#notImplemented('encrypt');
  }
  async decrypt(): Promise<Buffer> {
    this.#notImplemented('decrypt');
  }
  async sign(): Promise<string> {
    this.#notImplemented('sign');
  }
  async verify(): Promise<boolean> {
    this.#notImplemented('verify');
  }
  publicKeyPem(): string {
    this.#notImplemented('publicKeyPem');
  }
  describe(): KeyProviderDescription {
    return {
      kind: this.kind,
      displayName: this.displayName,
      productionReady: true,
      signatureAlgorithm: 'Provider-defined',
      encryptionAlgorithm: 'Provider-defined',
      keyRotation: 'Managed by the key service',
      warning: 'Not implemented in this proof of concept.',
    };
  }
}

let provider: KeyManagementProvider | null = null;

export function keyProvider(): KeyManagementProvider {
  if (!provider) {
    provider = env.KEY_PROVIDER === 'kms' ? new CloudKmsProvider() : new LocalDevelopmentKeyProvider();
  }
  return provider;
}

/** Test helper: replaces the process-wide provider. */
export function __setKeyProvider(next: KeyManagementProvider | null): void {
  provider = next;
}
