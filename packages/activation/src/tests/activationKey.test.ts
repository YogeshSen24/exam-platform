import { describe, expect, it } from 'vitest';
import type { CategoryQuota, Difficulty } from '@sep/shared';
import { keyringFromPublicMaterial, keyringFromSecret } from '../deployment.js';
import { openActivationKey, sealActivationKey, validateActivation, InvalidKeyError, releaseWindowOpen } from '../seal.js';
import { normaliseKey, toDisplayForm } from '../format.js';
import { drawPaper, attemptSeed, DrawShortfallError } from '../draw.js';
import { summariseKey, describeKey } from '../describe.js';
import type { ActivationPayload } from '../types.js';

const SECRET = 'test-deployment-secret-that-is-long-enough-01';
const OTHER_SECRET = 'a-completely-different-deployment-secret-0002';

const QUOTAS: CategoryQuota[] = [
  {
    categoryId: 'cat-qa',
    categoryCode: 'QA',
    categoryName: 'Quantitative Aptitude',
    deliver: 2,
    poolSize: 6,
    difficultyMix: { EASY: 1, MEDIUM: 1, DIFFICULT: 0 },
    poolByDifficulty: { EASY: 3, MEDIUM: 2, DIFFICULT: 1 },
    marksPerQuestion: 2,
    negativeMarksPerQuestion: 0.5,
  },
  {
    categoryId: 'cat-lr',
    categoryCode: 'LR',
    categoryName: 'Logical Reasoning',
    deliver: 3,
    poolSize: 8,
    difficultyMix: { EASY: 1, MEDIUM: 1, DIFFICULT: 1 },
    poolByDifficulty: { EASY: 3, MEDIUM: 3, DIFFICULT: 2 },
    marksPerQuestion: 1,
    negativeMarksPerQuestion: 0,
  },
];

function payload(overrides: Partial<ActivationPayload> = {}): ActivationPayload {
  const now = Date.now();
  return {
    formatVersion: 1,
    keyId: 'key-0001',
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 7 * 86_400_000).toISOString(),
    issuedByUserId: 'user-1',
    issuedByName: 'Security Administrator',
    deploymentId: 'board-demo',
    centre: { id: 'centre-1', code: 'DEL-01', name: 'Delhi Centre 1' },
    exam: {
      id: 'exam-1',
      code: 'NTAE26',
      name: 'National Test 2026',
      manifestId: 'manifest-1',
      examVersion: 1,
      securityProfileId: 'ENHANCED',
    },
    window: {
      opensAt: new Date(now - 3_600_000).toISOString(),
      closesAt: new Date(now + 3 * 86_400_000).toISOString(),
      durationMinutes: 120,
    },
    rules: {
      verification: {
        fingerprint: 'OPTIONAL',
        faceAtLogin: true,
        facePresenceDuringExam: false,
        invigilatorResolvesFailures: true,
      },
      monitoring: {
        cameraMonitoring: true,
        loginSnapshot: true,
        snapshotIntervalSeconds: 30,
        multipleFaceDetection: true,
        evidenceRetentionDays: 30,
      },
      delivery: {
        quotas: QUOTAS,
        totalDelivered: 5,
        totalMarks: 7,
        randomizeQuestionOrder: true,
        randomizeOptionOrder: true,
        negativeMarking: true,
        allowFlagForReview: true,
        allowBackNavigation: true,
      },
      station: {
        trackStation: true,
        maxStations: 40,
        fullScreenExamShell: true,
        reportFocusLoss: true,
        allowedCidrs: [],
      },
    },
    labels: { room: 'Room 4', session: 'Morning', tags: { shift: 'A' } },
    note: 'Room 4, morning session.',
    ...overrides,
  };
}

describe('the examination key', () => {
  const issuer = keyringFromSecret('board-demo', SECRET);
  const reader = keyringFromPublicMaterial(issuer.publicMaterial);

  it('can be opened, and says which examination the machine will run', () => {
    const key = sealActivationKey(payload(), issuer);
    const opened = openActivationKey(key, reader);

    expect(opened.payload.exam.code).toBe('NTAE26');
    expect(opened.payload.centre.code).toBe('DEL-01');
    expect(opened.payload.rules.delivery.totalDelivered).toBe(5);
    expect(opened.keyFingerprint).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
  });

  it('survives the whitespace an email client adds', () => {
    const key = sealActivationKey(payload(), issuer);
    const mangled = `  ${toDisplayForm(key)}  \r\n`;

    expect(normaliseKey(mangled)).toBe(key);
    expect(openActivationKey(mangled, reader).payload.centre.code).toBe('DEL-01');
  });

  it('cannot be minted without the deployment secret', () => {
    expect(reader.signingKey).toBeNull();
    expect(() => sealActivationKey(payload(), reader)).toThrow(/cannot issue keys/i);
  });

  it('rejects a key signed by a different board', () => {
    const impostor = keyringFromSecret('board-demo', OTHER_SECRET);
    expect(() => openActivationKey(sealActivationKey(payload(), impostor), reader)).toThrow(InvalidKeyError);
  });

  it('rejects a key whose contents have been altered', () => {
    const segments = sealActivationKey(payload(), issuer).split('.');
    const ciphertext = Buffer.from(segments[3] as string, 'base64url');
    ciphertext[0] = (ciphertext[0] as number) ^ 0xff;
    segments[3] = ciphertext.toString('base64url');

    expect(() => openActivationKey(segments.join('.'), reader)).toThrow(/not genuine/i);
  });

  it('explains, rather than crashes, when the key is truncated', () => {
    const key = sealActivationKey(payload(), issuer);
    expect(() => openActivationKey(key.slice(0, 40), reader)).toThrow(/incomplete/i);
    expect(() => openActivationKey('hello world', reader)).toThrow(/does not look like an examination key/i);
  });

  it('carries the metadata that has to reach the results', () => {
    const opened = openActivationKey(sealActivationKey(payload(), issuer), reader);

    expect(opened.payload.labels.room).toBe('Room 4');
    expect(opened.payload.labels.session).toBe('Morning');
    expect(opened.payload.labels.tags.shift).toBe('A');
  });
});

describe('what the setup screen tells a moderator', () => {
  it('says which examination this machine is about to run', () => {
    expect(summariseKey(payload())).toMatch(/National Test 2026.*Delhi Centre 1.*Room 4/);
  });

  it('spells out the checks and the paper in plain language', () => {
    const lines = describeKey(payload());
    const find = (label: string) => lines.find((l) => l.label === label)?.value ?? '';

    expect(find('Candidates verify with')).toMatch(/application ID and password/);
    expect(find('Candidates verify with')).toMatch(/face check at sign-in/);
    expect(find('Questions per candidate')).toMatch(/5 questions worth 7 marks/);
    expect(find('Every candidate gets')).toMatch(/different selection/);
    expect(find('Recorded on every result')).toMatch(/shift: A/);
  });
});

describe('what the system will accept', () => {
  const context = { now: new Date(), deploymentId: 'board-demo' };

  it('accepts a key for this board', () => {
    expect(validateActivation(payload(), context)).toBeNull();
  });

  it('refuses an expired key', () => {
    const problem = validateActivation(payload({ expiresAt: new Date(Date.now() - 1000).toISOString() }), context);
    expect(problem?.message).toMatch(/expired/i);
  });

  it('refuses a key for another board', () => {
    expect(validateActivation(payload({ deploymentId: 'other-board' }), context)?.message).toMatch(
      /different examination board/i,
    );
  });

  it('refuses a key promising more questions than its pool holds', () => {
    const broken = payload();
    broken.rules.delivery.quotas = [{ ...(QUOTAS[0] as CategoryQuota), deliver: 9, poolSize: 6 }];
    broken.rules.delivery.totalDelivered = 9;
    expect(validateActivation(broken, context)?.message).toMatch(/pool of only 6/i);
  });

  it('knows whether candidates may start yet', () => {
    expect(releaseWindowOpen(payload())).toBe(true);

    const future = payload();
    future.window.opensAt = new Date(Date.now() + 86_400_000).toISOString();
    expect(releaseWindowOpen(future)).toBe(false);
  });
});

describe('per-candidate draw', () => {
  const band = (i: number, easy: number, medium: number): Difficulty =>
    i < easy ? 'EASY' : i < easy + medium ? 'MEDIUM' : 'DIFFICULT';
  const pool = [
    ...Array.from({ length: 6 }, (_, i) => ({ questionId: `qa-${i}`, categoryId: 'cat-qa', difficulty: band(i, 3, 2) })),
    ...Array.from({ length: 8 }, (_, i) => ({ questionId: `lr-${i}`, categoryId: 'cat-lr', difficulty: band(i, 3, 3) })),
  ];
  const options = { randomizeQuestionOrder: true };

  it('gives every candidate the same number of questions from each category', () => {
    for (const candidateId of ['c1', 'c2', 'c3', 'c4', 'c5']) {
      const seed = attemptSeed({ manifestHash: 'm', candidateId, attemptId: `a-${candidateId}` });
      const drawn = drawPaper(pool, QUOTAS, seed, options);

      expect(drawn).toHaveLength(5);
      expect(drawn.filter((q) => q.categoryId === 'cat-qa')).toHaveLength(2);
      expect(drawn.filter((q) => q.categoryId === 'cat-lr')).toHaveLength(3);
      expect(new Set(drawn.map((q) => q.questionId)).size).toBe(5);
    }
  });

  it('gives different candidates different questions', () => {
    const first = drawPaper(pool, QUOTAS, attemptSeed({ manifestHash: 'm', candidateId: 'c1', attemptId: 'a1' }), options);
    const second = drawPaper(pool, QUOTAS, attemptSeed({ manifestHash: 'm', candidateId: 'c2', attemptId: 'a2' }), options);

    expect(first.map((q) => q.questionId)).not.toEqual(second.map((q) => q.questionId));
  });

  it('gives the same candidate the same paper back after a reconnection', () => {
    const seed = attemptSeed({ manifestHash: 'm', candidateId: 'c1', attemptId: 'a1' });
    expect(drawPaper(pool, QUOTAS, seed, options)).toEqual(drawPaper(pool, QUOTAS, seed, options));
  });

  it('draws identically whichever order the pool arrives in', () => {
    const seed = attemptSeed({ manifestHash: 'm', candidateId: 'c1', attemptId: 'a1' });
    expect(drawPaper([...pool].reverse(), QUOTAS, seed, options)).toEqual(drawPaper(pool, QUOTAS, seed, options));
  });

  it('keeps sections in order when the examination does not randomise order', () => {
    const seed = attemptSeed({ manifestHash: 'm', candidateId: 'c1', attemptId: 'a1' });
    const drawn = drawPaper(pool, QUOTAS, seed, { randomizeQuestionOrder: false });

    expect(drawn.slice(0, 2).every((q) => q.categoryId === 'cat-qa')).toBe(true);
    expect(drawn.slice(2).every((q) => q.categoryId === 'cat-lr')).toBe(true);
  });

  it('gives every candidate the same difficulty mix, not just the same count', () => {
    for (const candidateId of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']) {
      const drawn = drawPaper(pool, QUOTAS, attemptSeed({ manifestHash: 'm', candidateId, attemptId: candidateId }), options);
      const qa = drawn.filter((q) => q.categoryId === 'cat-qa');
      const lr = drawn.filter((q) => q.categoryId === 'cat-lr');

      expect(qa.filter((q) => q.difficulty === 'EASY')).toHaveLength(1);
      expect(qa.filter((q) => q.difficulty === 'MEDIUM')).toHaveLength(1);
      expect(lr.filter((q) => q.difficulty === 'EASY')).toHaveLength(1);
      expect(lr.filter((q) => q.difficulty === 'MEDIUM')).toHaveLength(1);
      expect(lr.filter((q) => q.difficulty === 'DIFFICULT')).toHaveLength(1);
    }
  });

  it('refuses to deliver a short paper when the pool is too small', () => {
    const thin = [{ questionId: 'qa-0', categoryId: 'cat-qa', difficulty: 'EASY' as const }];
    expect(() => drawPaper(thin, QUOTAS, 'seed', options)).toThrow(DrawShortfallError);
  });

  it('names the difficulty band that ran short, so the paper can be fixed', () => {
    const noHard = pool.filter((q) => !(q.categoryId === 'cat-lr' && q.difficulty === 'DIFFICULT'));
    expect(() => drawPaper(noHard, QUOTAS, 'seed', options)).toThrow(/only 0 difficult questions for category LR/i);
  });
});
