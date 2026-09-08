import type { SeedQuestion } from './questionBank.js';
import { createSeededRng } from '@sep/activation';

/**
 * Generated question pool.
 *
 * A candidate draws their paper from a pool that is larger than the paper, so
 * two people sitting side by side get different questions. Demonstrating that
 * needs a bank several times the size of the paper, which is more than is
 * worth writing by hand for a demonstration.
 *
 * These are generated from parameterised templates with computed answers, so
 * every question is genuinely distinct and genuinely correct, rather than the
 * same question relabelled. Content is synthetic and original, like the rest
 * of the demonstration data.
 */

type Template = (rng: () => number, index: number) => SeedQuestion | null;

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}

function intBetween(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Builds four options from one correct value and three plausible distractors. */
function options(correct: string, distractors: string[]): { text: string; isCorrect: boolean }[] {
  const seen = new Set([correct]);
  const unique = distractors.filter((d) => !seen.has(d) && seen.add(d)).slice(0, 3);
  return [{ text: correct, isCorrect: true }, ...unique.map((text) => ({ text, isCorrect: false }))];
}

/* ------------------------------------------------------------------ */
/* Quantitative Aptitude                                               */
/* ------------------------------------------------------------------ */

const speedDistance: Template = (rng) => {
  const speed = intBetween(rng, 40, 120);
  const hours = intBetween(rng, 2, 9);
  const distance = speed * hours;
  return {
    stem: `A vehicle covers ${distance} km at a steady ${speed} km/h. How long does the journey take?`,
    type: 'SINGLE_CHOICE',
    subject: 'Quantitative Aptitude',
    topic: 'Arithmetic',
    difficulty: hours <= 4 ? 'EASY' : 'MEDIUM',
    marks: 2,
    options: options(`${hours} hours`, [`${hours + 1} hours`, `${Math.max(1, hours - 1)} hours`, `${hours + 2} hours`]),
    explanation: `Time = distance / speed = ${distance} / ${speed} = ${hours} hours.`,
  };
};

const percentageChange: Template = (rng) => {
  const original = intBetween(rng, 200, 900) * 10;
  const percent = pick(rng, [5, 10, 12, 15, 20, 25]);
  const increased = original + (original * percent) / 100;
  return {
    stem: `A quantity of ${original} increases by ${percent}%. What is the new value?`,
    type: 'SINGLE_CHOICE',
    subject: 'Quantitative Aptitude',
    topic: 'Percentages',
    difficulty: percent % 10 === 0 ? 'EASY' : 'MEDIUM',
    marks: 2,
    options: options(String(increased), [
      String(original - (original * percent) / 100),
      String(original + percent),
      String(Math.round(original * (1 + percent / 50))),
    ]),
    explanation: `${original} + ${percent}% of ${original} = ${original} + ${(original * percent) / 100} = ${increased}.`,
  };
};

const consecutiveIntegers: Template = (rng) => {
  const middle = intBetween(rng, 8, 60) * 2;
  const sum = (middle - 2) + middle + (middle + 2);
  return {
    stem: `The sum of three consecutive even integers is ${sum}. What is the largest of the three?`,
    type: 'SINGLE_CHOICE',
    subject: 'Quantitative Aptitude',
    topic: 'Number Systems',
    difficulty: 'MEDIUM',
    marks: 2,
    options: options(String(middle + 2), [String(middle), String(middle - 2), String(middle + 4)]),
    explanation: `If the middle integer is n, then 3n = ${sum}, so n = ${middle} and the largest is ${middle + 2}.`,
  };
};

const workRate: Template = (rng) => {
  const a = pick(rng, [6, 8, 10, 12, 15, 20]);
  const b = pick(rng, [6, 8, 10, 12, 15, 20, 24, 30]);
  const combined = (a * b) / (a + b);
  if (!Number.isInteger(combined * 100)) return null;
  const rounded = Math.round(combined * 100) / 100;
  return {
    stem: `One machine completes a task in ${a} hours and another in ${b} hours. Working together, how long do they take?`,
    type: 'SINGLE_CHOICE',
    subject: 'Quantitative Aptitude',
    topic: 'Time and Work',
    difficulty: 'DIFFICULT',
    marks: 2,
    options: options(`${rounded} hours`, [`${Math.round((a + b) / 2)} hours`, `${a + b} hours`, `${Math.round(rounded + 1)} hours`]),
    explanation: `Combined rate = 1/${a} + 1/${b}. Time = ${a} x ${b} / (${a} + ${b}) = ${rounded} hours.`,
  };
};

/* ------------------------------------------------------------------ */
/* Logical Reasoning                                                   */
/* ------------------------------------------------------------------ */

const numberSeries: Template = (rng) => {
  const start = intBetween(rng, 2, 12);
  const step = intBetween(rng, 2, 9);
  const terms = [start, start + step, start + 2 * step, start + 3 * step];
  const next = start + 4 * step;
  return {
    stem: `What comes next in the series: ${terms.join(', ')}, ?`,
    type: 'SINGLE_CHOICE',
    subject: 'Logical Reasoning',
    topic: 'Series',
    difficulty: 'EASY',
    marks: 1,
    options: options(String(next), [String(next + step), String(next - 1), String(next + 1)]),
    explanation: `Each term increases by ${step}, so the next term is ${terms[3]} + ${step} = ${next}.`,
  };
};

const squareSeries: Template = (rng) => {
  const start = intBetween(rng, 2, 9);
  const terms = [start, start + 1, start + 2, start + 3].map((n) => n * n);
  const next = (start + 4) * (start + 4);
  return {
    stem: `Identify the next term: ${terms.join(', ')}, ?`,
    type: 'SINGLE_CHOICE',
    subject: 'Logical Reasoning',
    topic: 'Series',
    difficulty: 'MEDIUM',
    marks: 1,
    options: options(String(next), [String(next + 2 * (start + 4)), String((terms[3] as number) + 10), String(next - 1)]),
    explanation: `The terms are consecutive squares from ${start}^2, so the next is ${start + 4}^2 = ${next}.`,
  };
};

const relationships: Template = (rng) => {
  const relation = pick(rng, [
    { a: 'brother of my mother', answer: 'Uncle' },
    { a: 'sister of my father', answer: 'Aunt' },
    { a: 'son of my sister', answer: 'Nephew' },
    { a: 'daughter of my brother', answer: 'Niece' },
    { a: 'father of my father', answer: 'Grandfather' },
  ]);
  return {
    stem: `A person is the ${relation.a}. What relation is that person to me?`,
    type: 'SINGLE_CHOICE',
    subject: 'Logical Reasoning',
    topic: 'Blood Relations',
    difficulty: 'DIFFICULT',
    marks: 1,
    options: options(relation.answer, ['Cousin', 'Brother-in-law', 'Guardian']),
    explanation: `By definition, that person is my ${relation.answer.toLowerCase()}.`,
  };
};

/* ------------------------------------------------------------------ */
/* Verbal Ability                                                      */
/* ------------------------------------------------------------------ */

const SYNONYMS = [
  { word: 'abundant', answer: 'Plentiful', wrong: ['Scarce', 'Fragile', 'Hidden'], difficulty: 'EASY' as const },
  { word: 'candid', answer: 'Frank', wrong: ['Devious', 'Timid', 'Lavish'], difficulty: 'EASY' as const },
  { word: 'meticulous', answer: 'Careful', wrong: ['Hasty', 'Careless', 'Brave'], difficulty: 'MEDIUM' as const },
  { word: 'obsolete', answer: 'Outdated', wrong: ['Essential', 'Fragrant', 'Reliable'], difficulty: 'MEDIUM' as const },
  { word: 'prudent', answer: 'Sensible', wrong: ['Reckless', 'Jovial', 'Hollow'], difficulty: 'MEDIUM' as const },
  { word: 'tenacious', answer: 'Persistent', wrong: ['Yielding', 'Transparent', 'Sudden'], difficulty: 'DIFFICULT' as const },
  { word: 'ubiquitous', answer: 'Everywhere', wrong: ['Rare', 'Circular', 'Silent'], difficulty: 'DIFFICULT' as const },
  { word: 'laconic', answer: 'Brief', wrong: ['Talkative', 'Muddy', 'Elegant'], difficulty: 'DIFFICULT' as const },
  { word: 'gregarious', answer: 'Sociable', wrong: ['Solitary', 'Angry', 'Weightless'], difficulty: 'DIFFICULT' as const },
  { word: 'diligent', answer: 'Hard-working', wrong: ['Idle', 'Fickle', 'Loud'], difficulty: 'EASY' as const },
];

const synonym: Template = (_rng, index) => {
  const item = SYNONYMS[index % SYNONYMS.length] as (typeof SYNONYMS)[number];
  return {
    stem: `Choose the word closest in meaning to "${item.word}".`,
    type: 'SINGLE_CHOICE',
    subject: 'Verbal Ability',
    topic: 'Vocabulary',
    difficulty: item.difficulty,
    marks: 1,
    options: options(item.answer, item.wrong),
    explanation: `"${item.word}" means ${item.answer.toLowerCase()}.`,
  };
};

/* ------------------------------------------------------------------ */
/* Data Interpretation                                                 */
/* ------------------------------------------------------------------ */

const averageOf: Template = (rng) => {
  const values = Array.from({ length: 4 }, () => intBetween(rng, 20, 200));
  const total = values.reduce((sum, v) => sum + v, 0);
  if (total % 4 !== 0) return null;
  const average = total / 4;
  return {
    stem: `A branch recorded ${values.join(', ')} enquiries over four weeks. What was the weekly average?`,
    type: 'SINGLE_CHOICE',
    subject: 'Data Interpretation',
    topic: 'Averages',
    difficulty: 'MEDIUM',
    marks: 2,
    options: options(String(average), [String(total), String(average + 5), String(Math.max(...values))]),
    explanation: `Total is ${total} over 4 weeks, so the average is ${total} / 4 = ${average}.`,
  };
};

const shareOfTotal: Template = (rng) => {
  const part = intBetween(rng, 2, 40) * 5;
  const multiplier = pick(rng, [2, 4, 5, 10]);
  const total = part * multiplier;
  const percent = Math.round((part / total) * 100);
  return {
    stem: `Of ${total} applications received, ${part} came from one region. What share is that, to the nearest per cent?`,
    type: 'SINGLE_CHOICE',
    subject: 'Data Interpretation',
    topic: 'Proportions',
    difficulty: 'EASY',
    marks: 2,
    options: options(`${percent}%`, [`${percent + 10}%`, `${Math.max(1, percent - 5)}%`, `${percent * 2}%`]),
    explanation: `${part} / ${total} = ${(part / total).toFixed(2)}, which is ${percent}%.`,
  };
};

/* ------------------------------------------------------------------ */
/* Computer Fundamentals and General Awareness                         */
/* ------------------------------------------------------------------ */

const COMPUTER_FACTS = [
  { q: 'Which unit of a computer carries out arithmetic and logical operations?', a: 'Arithmetic logic unit', w: ['Control unit', 'Cache controller', 'Bus arbiter'], d: 'EASY' as const },
  { q: 'How many bytes are in one kibibyte?', a: '1024', w: ['1000', '512', '2048'], d: 'EASY' as const },
  { q: 'Which memory loses its contents when power is removed?', a: 'RAM', w: ['ROM', 'Flash storage', 'Hard disk'], d: 'EASY' as const },
  { q: 'What does a compiler produce from source code?', a: 'Machine code', w: ['A flowchart', 'A database schema', 'A network packet'], d: 'MEDIUM' as const },
  { q: 'Which structure follows last-in, first-out order?', a: 'Stack', w: ['Queue', 'Linked list', 'Binary tree'], d: 'MEDIUM' as const },
  { q: 'Which protocol resolves a domain name to an IP address?', a: 'DNS', w: ['DHCP', 'SMTP', 'FTP'], d: 'MEDIUM' as const },
  { q: 'What is the time complexity of binary search on a sorted array of n items?', a: 'O(log n)', w: ['O(n)', 'O(n log n)', 'O(1)'], d: 'DIFFICULT' as const },
  { q: 'Which normal form removes partial dependency on a composite key?', a: 'Second normal form', w: ['First normal form', 'Third normal form', 'Boyce-Codd normal form'], d: 'DIFFICULT' as const },
  { q: 'In public-key cryptography, which key verifies a digital signature?', a: 'The public key', w: ['The private key', 'The session key', 'The symmetric key'], d: 'DIFFICULT' as const },
];

const computing: Template = (_rng, index) => {
  const item = COMPUTER_FACTS[index % COMPUTER_FACTS.length] as (typeof COMPUTER_FACTS)[number];
  return {
    stem: item.q,
    type: 'SINGLE_CHOICE',
    subject: 'Computer Fundamentals',
    topic: 'Fundamentals',
    difficulty: item.d,
    marks: 1,
    options: options(item.a, item.w),
    explanation: `${item.a} is correct.`,
  };
};

const GENERAL_FACTS = [
  { q: 'How many minutes are there in three and a half hours?', a: '210', w: ['180', '240', '200'], d: 'EASY' as const },
  { q: 'How many degrees does the minute hand of a clock move in 20 minutes?', a: '120 degrees', w: ['90 degrees', '60 degrees', '180 degrees'], d: 'MEDIUM' as const },
  { q: 'If a year has 365 days, how many complete weeks does it contain?', a: '52', w: ['53', '51', '50'], d: 'EASY' as const },
  { q: 'What is the interior angle sum of a hexagon?', a: '720 degrees', w: ['540 degrees', '900 degrees', '640 degrees'], d: 'MEDIUM' as const },
  { q: 'A leap year occurs when the year is divisible by which number, with a century exception?', a: '4', w: ['2', '5', '10'], d: 'EASY' as const },
  { q: 'How many edges does a cube have?', a: '12', w: ['8', '6', '16'], d: 'MEDIUM' as const },
  { q: 'What is the highest common factor of 36 and 48?', a: '12', w: ['6', '18', '24'], d: 'DIFFICULT' as const },
  { q: 'How many diagonals does a regular pentagon have?', a: '5', w: ['4', '6', '10'], d: 'DIFFICULT' as const },
];

const general: Template = (_rng, index) => {
  const item = GENERAL_FACTS[index % GENERAL_FACTS.length] as (typeof GENERAL_FACTS)[number];
  return {
    stem: item.q,
    type: 'SINGLE_CHOICE',
    subject: 'General Awareness',
    topic: 'Reasoning and general knowledge',
    difficulty: item.d,
    marks: 1,
    options: options(item.a, item.w),
    explanation: `${item.a} is correct.`,
  };
};

const TEMPLATES: Template[] = [
  speedDistance,
  percentageChange,
  consecutiveIntegers,
  workRate,
  numberSeries,
  squareSeries,
  relationships,
  synonym,
  averageOf,
  shareOfTotal,
  computing,
  general,
];

/**
 * Generates a pool of distinct questions.
 *
 * Deterministic: the same seed always produces the same pool, so the
 * demonstration dataset is stable between restarts and a paper sealed on one
 * run still verifies on the next.
 */
export function generateQuestionPool(count: number, seed = 'sep-question-pool-v1'): SeedQuestion[] {
  const rng = createSeededRng(seed);
  const out: SeedQuestion[] = [];
  const seenStems = new Set<string>();

  let index = 0;
  let guard = 0;
  while (out.length < count && guard < count * 40) {
    guard += 1;
    const template = TEMPLATES[index % TEMPLATES.length] as Template;
    const question = template(rng, Math.floor(index / TEMPLATES.length));
    index += 1;
    if (!question) continue;
    if (question.options.length < 4) continue;
    if (seenStems.has(question.stem)) continue;
    seenStems.add(question.stem);
    out.push(question);
  }
  return out;
}
