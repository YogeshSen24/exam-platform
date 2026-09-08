import type { Difficulty, QuestionType } from './types.js';

/**
 * Question categories.
 *
 * Marks are a property of the **category**, not of the individual question.
 * Every question in a category is worth the same, which is how examination
 * boards actually publish a marking scheme — "Section A: 20 questions, 2 marks
 * each" rather than a per-question tariff nobody can audit.
 *
 * A question therefore never carries its own mark value. It carries a category,
 * and the category carries the marks. Changing a category's marks changes every
 * question in it consistently, and the paper manifest records the resolved value
 * so a published paper stays fixed even if the category is edited later.
 */

export interface QuestionCategory {
  id: string;
  /** Short code shown on the paper, e.g. "A", "QA", "SEC-1". */
  code: string;
  name: string;
  description: string;
  /** Every question in this category is worth exactly this many marks. */
  marksPerQuestion: number;
  /** Deducted per incorrect answer when the examination enables it. */
  negativeMarksPerQuestion: number;
  /** Question types this category accepts. */
  allowedTypes: QuestionType[];
  /** Subject this category draws from, or null for mixed. */
  subject: string | null;
  /** Display order on the paper and in the navigator. */
  ordinal: number;
  /** Word limit applied to paragraph answers in this category. */
  paragraphWordLimit: number | null;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

/** How many questions an exam draws from a category, and at what difficulty. */
export interface ExamCategoryAllocation {
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  questionCount: number;
  /** Resolved at allocation time, so a later category edit cannot alter a published paper. */
  marksPerQuestion: number;
  negativeMarksPerQuestion: number;
  difficultyMix: Record<Difficulty, number>;
  /** Marks contributed by this category = questionCount × marksPerQuestion. */
  totalMarks: number;
}

export function allocationTotal(allocation: ExamCategoryAllocation): number {
  return allocation.questionCount * allocation.marksPerQuestion;
}

export function allocationsTotalMarks(allocations: ExamCategoryAllocation[]): number {
  return allocations.reduce((sum, a) => sum + allocationTotal(a), 0);
}

export function allocationsTotalQuestions(allocations: ExamCategoryAllocation[]): number {
  return allocations.reduce((sum, a) => sum + a.questionCount, 0);
}

/** Default categories seeded for a new organisation. */
export const DEFAULT_CATEGORIES: Omit<QuestionCategory, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    code: 'QA',
    name: 'Quantitative Aptitude',
    description: 'Arithmetic, algebra, geometry and number systems. Objective questions only.',
    marksPerQuestion: 2,
    negativeMarksPerQuestion: 0.5,
    allowedTypes: ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE'],
    subject: 'Quantitative Aptitude',
    ordinal: 1,
    paragraphWordLimit: null,
    archived: false,
  },
  {
    code: 'LR',
    name: 'Logical Reasoning',
    description: 'Series, syllogism, puzzles and coding-decoding. Objective questions only.',
    marksPerQuestion: 2,
    negativeMarksPerQuestion: 0.5,
    allowedTypes: ['SINGLE_CHOICE', 'MULTIPLE_CHOICE'],
    subject: 'Logical Reasoning',
    ordinal: 2,
    paragraphWordLimit: null,
    archived: false,
  },
  {
    code: 'VA',
    name: 'Verbal Ability',
    description: 'Grammar, vocabulary and comprehension.',
    marksPerQuestion: 2,
    negativeMarksPerQuestion: 0.5,
    allowedTypes: ['SINGLE_CHOICE', 'MULTIPLE_CHOICE'],
    subject: 'Verbal Ability',
    ordinal: 3,
    paragraphWordLimit: null,
    archived: false,
  },
  {
    code: 'DI',
    name: 'Data Interpretation',
    description: 'Tables, charts and caselets.',
    marksPerQuestion: 3,
    negativeMarksPerQuestion: 1,
    allowedTypes: ['SINGLE_CHOICE', 'MULTIPLE_CHOICE'],
    subject: 'Data Interpretation',
    ordinal: 4,
    paragraphWordLimit: null,
    archived: false,
  },
  {
    code: 'GA',
    name: 'General Awareness',
    description: 'Polity, economy, science and current affairs.',
    marksPerQuestion: 1,
    negativeMarksPerQuestion: 0.25,
    allowedTypes: ['SINGLE_CHOICE', 'TRUE_FALSE'],
    subject: 'General Awareness',
    ordinal: 5,
    paragraphWordLimit: null,
    archived: false,
  },
  {
    code: 'CF',
    name: 'Computer Fundamentals',
    description: 'Networking, operating systems, databases and security basics.',
    marksPerQuestion: 2,
    negativeMarksPerQuestion: 0.5,
    allowedTypes: ['SINGLE_CHOICE', 'MULTIPLE_CHOICE'],
    subject: 'Computer Fundamentals',
    ordinal: 6,
    paragraphWordLimit: null,
    archived: false,
  },
  {
    code: 'DESC',
    name: 'Descriptive Writing',
    description:
      'Paragraph answers marked by a human examiner. No automatic marking and no negative marking.',
    marksPerQuestion: 10,
    negativeMarksPerQuestion: 0,
    allowedTypes: ['PARAGRAPH', 'SHORT_TEXT'],
    subject: null,
    ordinal: 7,
    paragraphWordLimit: 300,
    archived: false,
  },
];
