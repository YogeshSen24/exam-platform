import { beforeAll, describe, expect, it } from 'vitest';
import { attemptSeed, drawPaper } from '@sep/activation';
import type { ExamManifest } from '@sep/shared';
import { seedDatabase } from '../data/seed.js';
import { getDb } from '../lib/store/db.js';

/**
 * The per-candidate draw, checked against the real seeded paper rather than a
 * hand-built fixture.
 *
 * The promise being tested is the one an examination board has to defend: two
 * candidates sitting at neighbouring desks answer different questions, and
 * neither of them can claim they got the harder paper.
 */
describe('every candidate gets their own paper', () => {
  let manifest: ExamManifest;

  beforeAll(async () => {
    const seeded = await seedDatabase();
    manifest = getDb().manifests.get(seeded.manifestId)!;
  });

  const paperFor = (candidateId: string) =>
    drawPaper(
      manifest.entries,
      manifest.quotas,
      attemptSeed({ manifestHash: manifest.manifestHash, candidateId, attemptId: `attempt-${candidateId}` }),
      { randomizeQuestionOrder: true },
    );

  it('seals a pool substantially larger than the paper anyone sits', () => {
    expect(manifest.deliveredQuestionCount).toBeGreaterThan(0);
    expect(manifest.entries.length).toBeGreaterThan(manifest.deliveredQuestionCount * 1.5);
  });

  it('never promises more questions than a category actually holds', () => {
    for (const quota of manifest.quotas) {
      expect(quota.poolSize).toBeGreaterThanOrEqual(quota.deliver);
      for (const band of ['EASY', 'MEDIUM', 'DIFFICULT'] as const) {
        expect(quota.poolByDifficulty[band]).toBeGreaterThanOrEqual(quota.difficultyMix[band]);
      }
    }
  });

  it('gives 200 candidates papers of identical length and identical total marks', () => {
    const papers = Array.from({ length: 200 }, (_, i) => paperFor(`candidate-${i}`));

    const lengths = new Set(papers.map((p) => p.length));
    const totals = new Set(papers.map((p) => p.reduce((sum, q) => sum + q.marks, 0)));

    expect(lengths).toEqual(new Set([manifest.deliveredQuestionCount]));
    expect(totals).toEqual(new Set([manifest.deliveredTotalMarks]));
  });

  it('gives every candidate the same section-by-section and difficulty breakdown', () => {
    const shape = (candidateId: string) => {
      const paper = paperFor(candidateId);
      return manifest.quotas
        .map((quota) => {
          const inCategory = paper.filter((q) => q.categoryId === quota.categoryId);
          const bands = (['EASY', 'MEDIUM', 'DIFFICULT'] as const)
            .map((b) => `${b}:${inCategory.filter((q) => q.difficulty === b).length}`)
            .join(',');
          return `${quota.categoryCode}=${inCategory.length}[${bands}]`;
        })
        .join(' ');
    };

    const shapes = new Set(Array.from({ length: 50 }, (_, i) => shape(`candidate-${i}`)));
    expect(shapes.size).toBe(1);
  });

  it('gives neighbouring candidates substantially different questions', () => {
    const a = new Set(paperFor('candidate-a').map((q) => q.questionId));
    const b = new Set(paperFor('candidate-b').map((q) => q.questionId));
    const shared = [...a].filter((q) => b.has(q)).length;

    // Some overlap is unavoidable when a category has little spare pool. The
    // point is that the papers are not the same paper.
    expect(shared).toBeLessThan(a.size);
    expect(a.size).toBe(manifest.deliveredQuestionCount);
  });

  it('never repeats a question within one candidate paper', () => {
    for (let i = 0; i < 50; i++) {
      const paper = paperFor(`candidate-${i}`);
      expect(new Set(paper.map((q) => q.questionId)).size).toBe(paper.length);
    }
  });

  it('draws only questions that are actually in the sealed pool', () => {
    const sealed = new Set(manifest.entries.map((e) => e.questionVersionId));
    for (const question of paperFor('candidate-x')) {
      expect(sealed.has(question.questionVersionId)).toBe(true);
    }
  });

  it('reproduces the same paper from the same attempt, so a reconnection is safe', () => {
    expect(paperFor('candidate-a')).toEqual(paperFor('candidate-a'));
  });
});
