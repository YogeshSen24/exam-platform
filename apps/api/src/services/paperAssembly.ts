import type { CategoryQuota, Difficulty, Exam, QuestionVersion } from '@sep/shared';

/**
 * Turning an approved question bank into a sealed pool.
 *
 * The blueprint says what each candidate receives. This decides what gets
 * sealed: every approved question that fits a category's marking scheme, which
 * is normally several times the delivered paper. Candidates then draw from
 * that pool, so the examination is identical in shape for everyone without
 * being identical in content.
 *
 * Used by the seed and by the assemble endpoint, so a demonstration paper and
 * a real one are built the same way.
 */

const BANDS: Difficulty[] = ['EASY', 'MEDIUM', 'DIFFICULT'];

export interface AssemblyShortfall {
  categoryName: string;
  categoryCode: string;
  difficulty: Difficulty;
  available: number;
  required: number;
}

export interface AssembledPool {
  versions: QuestionVersion[];
  quotas: CategoryQuota[];
  shortfalls: AssemblyShortfall[];
}

function emptyBands(): Record<Difficulty, number> {
  return { EASY: 0, MEDIUM: 0, DIFFICULT: 0 };
}

/**
 * Collects the pool and the per-candidate quotas for one examination.
 *
 * Reports every shortfall rather than throwing on the first, so an
 * administrator sees the whole problem at once instead of fixing one category
 * and rediscovering the next.
 */
export function assemblePool(exam: Exam, approved: readonly QuestionVersion[]): AssembledPool {
  const versions: QuestionVersion[] = [];
  const quotas: CategoryQuota[] = [];
  const shortfalls: AssemblyShortfall[] = [];

  for (const allocation of exam.blueprint.categoryAllocations) {
    const poolByDifficulty = emptyBands();
    let poolSize = 0;

    for (const band of BANDS) {
      // A question only belongs in this pool if its marking matches the
      // allocation. Mixing marking schemes inside a category would make two
      // candidates' papers worth different totals.
      const pool = approved.filter(
        (v) =>
          v.categoryId === allocation.categoryId &&
          v.difficulty === band &&
          v.marks === allocation.marksPerQuestion &&
          v.negativeMarks === allocation.negativeMarksPerQuestion,
      );
      const needed = allocation.difficultyMix[band];

      if (pool.length < needed) {
        shortfalls.push({
          categoryName: allocation.categoryName,
          categoryCode: allocation.categoryCode,
          difficulty: band,
          available: pool.length,
          required: needed,
        });
      }

      versions.push(...pool);
      poolByDifficulty[band] = pool.length;
      poolSize += pool.length;
    }

    quotas.push({
      categoryId: allocation.categoryId,
      categoryCode: allocation.categoryCode,
      categoryName: allocation.categoryName,
      deliver: allocation.questionCount,
      poolSize,
      difficultyMix: { ...allocation.difficultyMix },
      poolByDifficulty,
      marksPerQuestion: allocation.marksPerQuestion,
      negativeMarksPerQuestion: allocation.negativeMarksPerQuestion,
    });
  }

  return { versions, quotas, shortfalls };
}

/** One sentence per shortfall, written for an administrator rather than a log. */
export function describeShortfall(shortfall: AssemblyShortfall): string {
  return `${shortfall.categoryName} needs ${shortfall.required} ${shortfall.difficulty.toLowerCase()} question${
    shortfall.required === 1 ? '' : 's'
  }; ${shortfall.available} ${shortfall.available === 1 ? 'is' : 'are'} approved with this marking scheme.`;
}
