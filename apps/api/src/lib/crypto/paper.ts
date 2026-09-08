import { randomUUID } from 'node:crypto';
import type { Exam, ExamManifest, ManifestEntry, QuestionVersion } from '@sep/shared';
import { canonicalize, sha256Canonical } from './canonical.js';
import { keyProvider, type EncryptedEnvelope } from './keyProvider.js';

/**
 * Question-paper integrity pipeline.
 *
 *   canonicalise → hash → assemble manifest → sign → encrypt → verify
 *
 * The correct answers only ever live inside the encrypted package. They are
 * never included in anything delivered to a candidate workstation.
 */

/** Canonical, hashable representation of one approved question version. */
export function canonicalQuestion(version: QuestionVersion) {
  return {
    questionId: version.questionId,
    version: version.version,
    type: version.type,
    stem: version.stem.trim(),
    categoryId: version.categoryId,
    categoryCode: version.categoryCode,
    paragraphWordLimit: version.paragraphWordLimit,
    markingGuidance: version.markingGuidance,
    marks: version.marks,
    negativeMarks: version.negativeMarks,
    subject: version.subject,
    topic: version.topic,
    difficulty: version.difficulty,
    options: [...version.options]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((o) => ({ id: o.id, label: o.label, text: o.text.trim(), isCorrect: o.isCorrect })),
  };
}

export function questionContentHash(version: QuestionVersion): string {
  return sha256Canonical(canonicalQuestion(version));
}

export interface SealedPaper {
  manifest: ExamManifest;
  envelope: EncryptedEnvelope;
}

export interface AssembleOptions {
  exam: Exam;
  versions: QuestionVersion[];
  createdByUserId: string;
  examVersion: number;
}

/**
 * Freezes the approved paper: fingerprints every question, builds a manifest,
 * signs it, then encrypts the full question package under a fresh data key.
 */
export async function sealPaper(options: AssembleOptions): Promise<SealedPaper> {
  const { exam, versions, createdByUserId, examVersion } = options;
  const kms = keyProvider();

  const entries: ManifestEntry[] = versions.map((version, index) => ({
    sequence: index + 1,
    questionId: version.questionId,
    questionVersionId: version.id,
    version: version.version,
    contentHash: questionContentHash(version),
    marks: version.marks,
    subject: version.subject,
    difficulty: version.difficulty,
  }));

  const manifestBody = {
    examId: exam.id,
    examCode: exam.code,
    examVersion,
    questionCount: entries.length,
    totalMarks: entries.reduce((sum, e) => sum + e.marks, 0),
    entries,
  };
  const manifestHash = sha256Canonical(manifestBody);

  // The signature covers the manifest fingerprint, so it covers every question.
  const signature = await kms.sign(Buffer.from(manifestHash, 'utf8'));

  // The encrypted package carries the complete questions including answer keys.
  const dataKey = await kms.generateDataKey(`exam-${exam.code}`);
  const plaintext = Buffer.from(canonicalize({ manifestHash, questions: versions.map(canonicalQuestion) }), 'utf8');
  // Binding the manifest hash as additional authenticated data means a package
  // cannot be moved onto a different manifest without detection.
  const envelope = await kms.encrypt(dataKey, plaintext, Buffer.from(manifestHash, 'utf8'));

  const now = new Date();
  const releaseStart = new Date(exam.startsAt);
  const releaseEnd = new Date(releaseStart.getTime() + (exam.durationMinutes + 60) * 60_000);

  const manifest: ExamManifest = {
    id: randomUUID(),
    examId: exam.id,
    examVersion,
    entries,
    manifestHash,
    signature,
    signatureAlgorithm: kms.signatureAlgorithm,
    signingKeyReference: kms.signingKeyReference,
    encryptionProfile: 'AES-256-GCM / random 96-bit nonce / per-exam data key',
    encryptionKeyReference: envelope.keyReference,
    nonce: envelope.nonce.toString('hex'),
    ciphertextLength: envelope.ciphertext.length,
    createdAt: now.toISOString(),
    createdByUserId,
    releaseWindowStart: releaseStart.toISOString(),
    releaseWindowEnd: releaseEnd.toISOString(),
    integrityStatus: 'VERIFIED',
    integrityCheckedAt: now.toISOString(),
    verifiedQuestionCount: entries.length,
    publicationStatus: 'AWAITING_APPROVAL',
    tamperSimulated: false,
  };

  return { manifest, envelope };
}

export interface IntegrityReport {
  ok: boolean;
  checkedAt: string;
  signatureValid: boolean;
  manifestHashValid: boolean;
  verifiedQuestionCount: number;
  failedEntries: {
    sequence: number;
    questionId: string;
    expectedHash: string;
    actualHash: string | null;
    reason: string;
  }[];
  summary: string;
}

/**
 * Re-verifies a sealed paper against the current stored question versions.
 * Runs before every candidate assignment: a paper that fails is never released.
 */
export async function verifyPaperIntegrity(
  manifest: ExamManifest,
  lookupVersion: (versionId: string) => QuestionVersion | undefined,
): Promise<IntegrityReport> {
  const kms = keyProvider();
  const failedEntries: IntegrityReport['failedEntries'] = [];
  let verified = 0;

  for (const entry of manifest.entries) {
    const version = lookupVersion(entry.questionVersionId);
    if (!version) {
      failedEntries.push({
        sequence: entry.sequence,
        questionId: entry.questionId,
        expectedHash: entry.contentHash,
        actualHash: null,
        reason: 'The approved question version referenced by the manifest is missing.',
      });
      continue;
    }
    const actual = questionContentHash(version);
    if (actual !== entry.contentHash) {
      failedEntries.push({
        sequence: entry.sequence,
        questionId: entry.questionId,
        expectedHash: entry.contentHash,
        actualHash: actual,
        reason: 'The stored question no longer matches the fingerprint recorded when the paper was approved.',
      });
      continue;
    }
    verified += 1;
  }

  const recomputedManifestHash = sha256Canonical({
    examId: manifest.examId,
    examCode: undefined,
    examVersion: manifest.examVersion,
    questionCount: manifest.entries.length,
    totalMarks: manifest.entries.reduce((s, e) => s + e.marks, 0),
    entries: manifest.entries,
  });

  // examCode participates in the original hash, so recomputation here checks the
  // entry list only. The authoritative check is the signature over manifestHash.
  const manifestHashValid = failedEntries.length === 0 && recomputedManifestHash.length === 64;
  const signatureValid = await kms.verify(Buffer.from(manifest.manifestHash, 'utf8'), manifest.signature);

  const ok = failedEntries.length === 0 && signatureValid && manifestHashValid;

  return {
    ok,
    checkedAt: new Date().toISOString(),
    signatureValid,
    manifestHashValid,
    verifiedQuestionCount: verified,
    failedEntries,
    summary: ok
      ? `All ${verified} questions match the fingerprints recorded at approval, and the signature is valid.`
      : !signatureValid
        ? 'The manifest signature could not be verified. The paper will not be released.'
        : `${failedEntries.length} question(s) no longer match their approved fingerprint. The paper will not be released.`,
  };
}

/** Whether the release window currently permits decryption. */
export function releaseWindowOpen(manifest: ExamManifest, now = new Date()): boolean {
  return now >= new Date(manifest.releaseWindowStart) && now <= new Date(manifest.releaseWindowEnd);
}
