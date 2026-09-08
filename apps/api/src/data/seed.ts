import { randomUUID } from 'node:crypto';
import {
  SECURITY_PROFILE_DEFINITIONS,
  DEFAULT_CATEGORIES,
  defaultVerificationPolicy,
  type Candidate,
  type Exam,
  type ExamAttempt,
  type ExaminationCentre,
  type ExaminationDevice,
  type Incident,
  type ProctoringEvent,
  type Question,
  type QuestionStatus,
  type QuestionVersion,
  type Role,
  type User,
} from '@sep/shared';
import { hashPassword } from '../lib/password.js';
import { recordAudit } from '../lib/audit.js';
import { emptyDatabase, replaceDb, getDb, type Database } from '../lib/store/db.js';
import { questionContentHash, sealPaper } from '../lib/crypto/paper.js';
import { __setKeyProvider } from '../lib/crypto/keyProvider.js';
import { stableIndex } from '../lib/random.js';
import { SEED_QUESTIONS } from './questionBank.js';
import { syntheticName } from './names.js';

/**
 * Complete client-demonstration scenario.
 *
 * Everything here is synthetic. No real candidate, biometric or examination
 * content is used. Passwords are development-only and are surfaced in the UI as
 * clearly marked demo credentials.
 */

export const DEMO_STAFF_PASSWORD = 'Demo!Pass2026';
export const DEMO_CANDIDATE_PASSWORD = 'Exam!2026';

export interface DemoAccount {
  role: Role;
  email: string;
  fullName: string;
  password: string;
  description: string;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    role: 'SUPER_ADMIN',
    email: 'super.admin@examboard.demo',
    fullName: 'Priya Raghavan',
    password: DEMO_STAFF_PASSWORD,
    description: 'Users, centres, devices, system security profiles and audit access.',
  },
  {
    role: 'EXAM_ADMIN',
    email: 'exam.admin@examboard.demo',
    fullName: 'Nikhil Bhandari',
    password: DEMO_STAFF_PASSWORD,
    description: 'Creates examinations, registers candidates, requests publication.',
  },
  {
    role: 'QUESTION_AUTHOR',
    email: 'author@examboard.demo',
    fullName: 'Sara Mathew',
    password: DEMO_STAFF_PASSWORD,
    description: 'Writes and submits questions for review.',
  },
  {
    role: 'QUESTION_REVIEWER',
    email: 'reviewer@examboard.demo',
    fullName: 'Dr. Anand Krishnan',
    password: DEMO_STAFF_PASSWORD,
    description: 'Approves questions and co-approves publication.',
  },
  {
    role: 'SECURITY_ADMIN',
    email: 'security.admin@examboard.demo',
    fullName: 'Farida Qureshi',
    password: DEMO_STAFF_PASSWORD,
    description: 'Networks, devices, certificates and question-release policy.',
  },
  {
    role: 'INVIGILATOR',
    email: 'invigilator@examboard.demo',
    fullName: 'Rakesh Menon',
    password: DEMO_STAFF_PASSWORD,
    description: 'Live session monitoring, warnings and reverification approvals.',
  },
];

/** The candidate account used in the scripted demonstration. */
export const DEMO_CANDIDATE_APPLICATION_ID = 'NTAE26-000001';

const now = () => new Date();

function iso(offsetMinutes: number, base = now()): string {
  return new Date(base.getTime() + offsetMinutes * 60_000).toISOString();
}

/* ------------------------------------------------------------------ */

function seedCentres(db: Database): ExaminationCentre[] {
  const centres: ExaminationCentre[] = [
    {
      id: 'centre-central',
      code: 'CEC-01',
      name: 'Central Examination Centre',
      city: 'Bengaluru',
      region: 'South',
      capacity: 600,
      primaryCidr: '10.42.0.0/16',
      backupCidr: '10.43.0.0/16',
      ipv6Cidr: '2001:db8:42::/48',
      contactName: 'Latha Subramanian',
      contactPhone: '+91 80 4000 1200',
      status: 'ACTIVE',
    },
    {
      id: 'centre-north',
      code: 'NEC-02',
      name: 'Northern Regional Centre',
      city: 'New Delhi',
      region: 'North',
      capacity: 320,
      primaryCidr: '10.52.0.0/16',
      backupCidr: null,
      ipv6Cidr: null,
      contactName: 'Vikas Ahluwalia',
      contactPhone: '+91 11 4000 8800',
      status: 'ACTIVE',
    },
    {
      id: 'centre-west',
      code: 'WEC-03',
      name: 'Western Regional Centre',
      city: 'Pune',
      region: 'West',
      capacity: 240,
      primaryCidr: '10.62.0.0/16',
      backupCidr: null,
      ipv6Cidr: null,
      contactName: 'Meenal Deshpande',
      contactPhone: '+91 20 4000 5500',
      status: 'INACTIVE',
    },
  ];
  centres.forEach((c) => db.centres.set(c.id, c));
  return centres;
}

function seedDevices(db: Database): ExaminationDevice[] {
  const devices: ExaminationDevice[] = [];
  for (let i = 1; i <= 25; i += 1) {
    const code = `WS-CEC-${String(i).padStart(3, '0')}`;
    // A deterministic sprinkling of imperfect devices makes the readiness
    // report meaningful rather than a wall of green.
    const revoked = i === 24;
    const pending = i === 25;
    const cameraFail = i === 7;
    const scannerWarn = i === 12 || i === 19;
    const certExpiring = i === 5 || i === 18;

    const issuedAt = iso(-60 * 24 * 300);
    const expiresAt = certExpiring ? iso(60 * 24 * 21) : iso(60 * 24 * 400);

    devices.push({
      id: `device-${i}`,
      deviceCode: code,
      name: `Examination workstation ${i}`,
      centreId: 'centre-central',
      operatingSystem: 'Windows 11 Enterprise 23H2',
      kioskPolicyVersion: i % 9 === 0 ? '2025.08.1' : '2026.01.3',
      status: revoked ? 'REVOKED' : pending ? 'PENDING' : 'APPROVED',
      certificate: {
        serial: `3A:${String(i).padStart(2, '0')}:9F:C4:${(i * 7).toString(16).padStart(2, '0').toUpperCase()}`,
        subject: `CN=${code}, OU=Examination Workstations, O=Examination Board`,
        issuer: 'CN=Examination Board Device CA, O=Examination Board',
        issuedAt,
        expiresAt,
        status: revoked ? 'REVOKED' : certExpiring ? 'EXPIRING' : 'VALID',
        thumbprint: `${stableIndex(code, 0xffffff).toString(16).padStart(6, '0')}${stableIndex(code + 'x', 0xffffff).toString(16).padStart(6, '0')}`,
      },
      lastHealthCheckAt: iso(-(i % 7) * 11),
      cameraStatus: cameraFail ? 'FAIL' : 'OK',
      fingerprintScannerStatus: scannerWarn ? 'WARNING' : 'OK',
      networkStatus: revoked ? 'UNKNOWN' : 'OK',
      ipAddress: `10.42.10.${10 + i}`,
      notes: revoked
        ? 'Revoked after a chassis intrusion alert during the November maintenance window.'
        : pending
          ? 'Newly imaged. Awaiting security administrator approval.'
          : null,
    });
  }
  devices.forEach((d) => db.devices.set(d.id, d));
  return devices;
}

function seedUsers(db: Database): User[] {
  const users: User[] = [];
  const sharedCredential = hashPassword(DEMO_STAFF_PASSWORD);

  DEMO_ACCOUNTS.forEach((account, index) => {
    const user: User = {
      id: `user-${account.role.toLowerCase().replace(/_/g, '-')}`,
      email: account.email,
      fullName: account.fullName,
      roles: [account.role],
      centreId: account.role === 'INVIGILATOR' ? 'centre-central' : null,
      status: 'ACTIVE',
      lastLoginAt: iso(-(index + 1) * 47),
      createdAt: iso(-60 * 24 * 210),
      isDemoAccount: true,
    };
    users.push(user);
    db.users.set(user.id, user);
    db.staffCredentials.set(user.id, {
      userId: user.id,
      passwordHash: sharedCredential.hash,
      salt: sharedCredential.salt,
      demoPassword: account.password,
    });
  });

  // Additional non-demo staff so lists and filters look realistic.
  const extras: { name: string; email: string; role: Role }[] = [
    { name: 'Kavitha Rangan', email: 'k.rangan@examboard.demo', role: 'QUESTION_AUTHOR' },
    { name: 'Imtiaz Sheikh', email: 'i.sheikh@examboard.demo', role: 'QUESTION_AUTHOR' },
    { name: 'Dr. Leela Nambiar', email: 'l.nambiar@examboard.demo', role: 'QUESTION_REVIEWER' },
    { name: 'Sunil Pandit', email: 's.pandit@examboard.demo', role: 'INVIGILATOR' },
    { name: 'Ritu Bhalla', email: 'r.bhalla@examboard.demo', role: 'INVIGILATOR' },
    { name: 'Ajay Kurup', email: 'a.kurup@examboard.demo', role: 'EXAM_ADMIN' },
  ];
  extras.forEach((extra, i) => {
    const user: User = {
      id: `user-extra-${i}`,
      email: extra.email,
      fullName: extra.name,
      roles: [extra.role],
      centreId: extra.role === 'INVIGILATOR' ? 'centre-central' : null,
      status: 'ACTIVE',
      lastLoginAt: iso(-(i + 3) * 180),
      createdAt: iso(-60 * 24 * 160),
      isDemoAccount: false,
    };
    users.push(user);
    db.users.set(user.id, user);
    db.staffCredentials.set(user.id, {
      userId: user.id,
      passwordHash: sharedCredential.hash,
      salt: sharedCredential.salt,
      demoPassword: DEMO_STAFF_PASSWORD,
    });
  });

  return users;
}

interface SeededQuestions {
  questions: Question[];
  versions: QuestionVersion[];
  approvedVersions: QuestionVersion[];
}

function seedQuestions(db: Database): SeededQuestions {
  for (const category of DEFAULT_CATEGORIES) {
    const id = `category-${category.code.toLowerCase()}`;
    db.categories.set(id, { ...category, id, createdAt: iso(-100), updatedAt: iso(-100) });
  }
  const questions: Question[] = [];
  const versions: QuestionVersion[] = [];
  const authors = ['user-question-author', 'user-extra-0', 'user-extra-1'];

  SEED_QUESTIONS.forEach((seed, index) => {
    const questionId = `question-${String(index + 1).padStart(3, '0')}`;
    const authorUserId = authors[index % authors.length] as string;

    // 50 approved (the published paper), then a mix of in-flight statuses.
    let status: QuestionStatus = 'APPROVED';
    if (index >= 50 && index < 54) status = 'IN_REVIEW';
    else if (index >= 54 && index < 57) status = 'DRAFT';
    else if (index >= 57 && index < 59) status = 'CHANGES_REQUESTED';
    else if (index === 59) status = 'RETIRED';

    const category = [...db.categories.values()].find(c => c.subject === seed.subject)!;
    const versionId = `qv-${questionId}-v1`;
    const version: QuestionVersion = {
      id: versionId,
      questionId,
      version: 1,
      stem: seed.stem,
      type: seed.type,
      options: seed.options.map((o, oi) => ({
        id: `${questionId}-opt-${oi + 1}`,
        label: String.fromCharCode(65 + oi),
        text: o.text,
        isCorrect: o.isCorrect,
      })),
      categoryId: category.id,
      categoryCode: category.code,
      marks: category.marksPerQuestion,
      negativeMarks: category.negativeMarksPerQuestion,
      paragraphWordLimit: category.paragraphWordLimit,
      markingGuidance: '',
      subject: seed.subject,
      topic: seed.topic,
      difficulty: seed.difficulty,
      explanation: seed.explanation,
      reviewerNotes: '',
      status,
      createdAt: iso(-60 * 24 * (90 - (index % 30))),
      createdByUserId: authorUserId,
      contentHash: '',
      // Nothing is published at seed time; publication happens after assembly.
      immutable: status === 'APPROVED',
    };
    version.contentHash = questionContentHash(version);
    versions.push(version);
    db.questionVersions.set(version.id, version);

    // Questions with a revision history make the version-difference view real.
    if (index < 6) {
      const v2Id = `qv-${questionId}-v2`;
      const v2: QuestionVersion = {
        ...version,
        id: v2Id,
        version: 2,
        stem: version.stem,
        reviewerNotes: 'Wording tightened after the first review cycle.',
        explanation: `${version.explanation} Reviewed and clarified in version 2.`,
        createdAt: iso(-60 * 24 * (40 - index)),
        contentHash: '',
        immutable: true,
      };
      v2.contentHash = questionContentHash(v2);
      versions.push(v2);
      db.questionVersions.set(v2.id, v2);

      const question: Question = {
        id: questionId,
        code: `Q-${String(index + 1).padStart(4, '0')}`,
        currentVersionId: v2.id,
        status,
        authorUserId,
        subject: seed.subject,
        topic: seed.topic,
        difficulty: seed.difficulty,
        categoryId: category.id,
      categoryCode: category.code,
      marks: category.marksPerQuestion,
        type: seed.type,
        createdAt: version.createdAt,
        updatedAt: v2.createdAt,
      };
      questions.push(question);
      db.questions.set(question.id, question);

      db.questionReviews.set(`review-${questionId}`, {
        id: `review-${questionId}`,
        questionId,
        questionVersionId: v2.id,
        reviewerUserId: 'user-question-reviewer',
        decision: 'APPROVED',
        comment: 'Content, key and marks verified against the blueprint. Approved for assembly.',
        createdAt: iso(-60 * 24 * (39 - index)),
      });
      return;
    }

    const question: Question = {
      id: questionId,
      code: `Q-${String(index + 1).padStart(4, '0')}`,
      currentVersionId: version.id,
      status,
      authorUserId,
      subject: seed.subject,
      topic: seed.topic,
      difficulty: seed.difficulty,
      categoryId: category.id,
      categoryCode: category.code,
      marks: category.marksPerQuestion,
      type: seed.type,
      createdAt: version.createdAt,
      updatedAt: version.createdAt,
    };
    questions.push(question);
    db.questions.set(question.id, question);

    if (status === 'APPROVED') {
      db.questionReviews.set(`review-${questionId}`, {
        id: `review-${questionId}`,
        questionId,
        questionVersionId: version.id,
        reviewerUserId: 'user-question-reviewer',
        decision: 'APPROVED',
        comment: 'Verified against the blueprint. Key confirmed.',
        createdAt: iso(-60 * 24 * 35),
      });
    } else if (status === 'CHANGES_REQUESTED') {
      db.questionReviews.set(`review-${questionId}`, {
        id: `review-${questionId}`,
        questionId,
        questionVersionId: version.id,
        reviewerUserId: 'user-question-reviewer',
        decision: 'CHANGES_REQUESTED',
        comment: 'Two options are too close in meaning. Please separate them and restate the stem.',
        createdAt: iso(-60 * 24 * 4),
      });
    }
  });

  const approvedVersions = questions
    .filter((q) => q.status === 'APPROVED')
    .map((q) => db.questionVersions.get(q.currentVersionId))
    .filter((v): v is QuestionVersion => Boolean(v));

  return { questions, versions, approvedVersions };
}

function buildExams(db: Database, approvedCount: number): { published: Exam; upcoming: Exam; draft: Exam } {
  const start = new Date();
  start.setMinutes(start.getMinutes() - 45); // in progress: started 45 minutes ago

  const maximum = SECURITY_PROFILE_DEFINITIONS.MAXIMUM_ASSURANCE;

  const published: Exam = {
    id: 'exam-ntae-2026-01',
    name: 'National Technical Aptitude Examination 2026',
    code: 'NTAE-2026-01',
    description:
      'Annual technical aptitude examination delivered at organisation-controlled examination centres under the Maximum Assurance security profile.',
    subject: 'General Aptitude',
    startsAt: start.toISOString(),
    durationMinutes: 120,
    reportingTime: '08:15',
    navigationMode: 'FREE',
    resultMode: 'AFTER_REVIEW',
    centreId: 'centre-central',
    timeZone: 'Asia/Kolkata',
    status: 'IN_PROGRESS',
    blueprint: {
      categoryAllocations: [],
      totalQuestions: 50,
      totalMarks: 100,
      difficultyDistribution: { EASY: 20, MEDIUM: 20, DIFFICULT: 10 },
      subjectDistribution: [
        { subject: 'Quantitative Aptitude', count: 10 },
        { subject: 'Logical Reasoning', count: 10 },
        { subject: 'Verbal Ability', count: 10 },
        { subject: 'Data Interpretation', count: 10 },
        { subject: 'General Awareness', count: 5 },
        { subject: 'Computer Fundamentals', count: 5 },
      ],
      mandatoryQuestionIds: [],
      randomPools: [
        { name: 'Quantitative pool', subject: 'Quantitative Aptitude', drawCount: 10, poolSize: 10 },
        { name: 'Reasoning pool', subject: 'Logical Reasoning', drawCount: 10, poolSize: 10 },
      ],
      negativeMarking: true,
      negativeMarkValue: 0.5,
      randomizeQuestionOrder: true,
      randomizeOptionOrder: true,
    },
    securityPolicy: {
      profileId: 'MAXIMUM_ASSURANCE',
      verification: { ...defaultVerificationPolicy('MAXIMUM_ASSURANCE'), requireNativeClient: false, requireAssignedDevice: false },
      monitoring: {
        cameraMonitoringEnabled: true,
        loginSnapshotEnabled: true,
        snapshotIntervalSeconds: 30,
        facePresenceDetection: true,
        identityComparison: true,
        multipleFaceDetection: true,
        consecutiveFailureThreshold: 3,
        reverificationMode: 'INVIGILATOR_APPROVED',
        humanReviewRequired: true,
        evidenceRetentionDays: 90,
        candidateNotice:
          'During this examination the workstation camera takes a low-resolution photograph every 30 seconds to confirm that you are present and alone. Images are used only to confirm presence and identity for this examination, are reviewed only by authorised examination staff, and are deleted after 90 days.',
      },
      network: {
        centreId: 'centre-central',
        primaryCidr: '10.42.0.0/16',
        backupCidr: '10.43.0.0/16',
        ipv6Cidr: '2001:db8:42::/48',
        deviceCertificateRequired: true,
        minimumDevicePolicyVersion: '2026.01.0',
        blockGeneralInternet: true,
        blockWorkstationToWorkstation: true,
        usbPolicy: 'BLOCKED',
        bluetoothPolicy: 'BLOCKED',
      },
      updatedAt: iso(-60 * 24 * 12),
      updatedByUserId: 'user-security-admin',
    },
    createdByUserId: 'user-exam-admin',
    createdAt: iso(-60 * 24 * 45),
    updatedAt: iso(-60 * 24 * 12),
    candidateCount: 500,
    manifestId: null,
  };
  void maximum;

  const draftStart = new Date();
  draftStart.setDate(draftStart.getDate() + 34);
  draftStart.setHours(10, 0, 0, 0);

  const draft: Exam = {
    id: 'exam-nsca-2026-02',
    name: 'National Skills Certification Assessment 2026 — Cycle 2',
    code: 'NSCA-2026-02',
    description: 'Second-cycle certification assessment. Blueprint agreed; paper assembly not yet started.',
    subject: 'Computer Fundamentals',
    startsAt: draftStart.toISOString(),
    durationMinutes: 90,
    reportingTime: '09:30',
    navigationMode: 'SECTION_BASED',
    resultMode: 'SCHEDULED',
    centreId: 'centre-north',
    timeZone: 'Asia/Kolkata',
    status: 'DRAFT',
    blueprint: {
      categoryAllocations: [],
      totalQuestions: 40,
      totalMarks: 80,
      difficultyDistribution: { EASY: 16, MEDIUM: 16, DIFFICULT: 8 },
      subjectDistribution: [
        { subject: 'Computer Fundamentals', count: 20 },
        { subject: 'Logical Reasoning', count: 10 },
        { subject: 'Data Interpretation', count: 10 },
      ],
      mandatoryQuestionIds: [],
      randomPools: [],
      negativeMarking: false,
      negativeMarkValue: 0,
      randomizeQuestionOrder: true,
      randomizeOptionOrder: false,
    },
    securityPolicy: {
      profileId: 'ENHANCED',
      verification: defaultVerificationPolicy('ENHANCED'),
      monitoring: {
        cameraMonitoringEnabled: true,
        loginSnapshotEnabled: true,
        snapshotIntervalSeconds: 60,
        facePresenceDetection: true,
        identityComparison: false,
        multipleFaceDetection: true,
        consecutiveFailureThreshold: 3,
        reverificationMode: 'AUTOMATIC',
        humanReviewRequired: false,
        evidenceRetentionDays: 30,
        candidateNotice:
          'The workstation camera confirms your presence during this assessment. Images are reviewed only by authorised staff and are deleted after 30 days.',
      },
      network: {
        centreId: 'centre-north',
        primaryCidr: '10.52.0.0/16',
        backupCidr: null,
        ipv6Cidr: null,
        deviceCertificateRequired: true,
        minimumDevicePolicyVersion: '2025.10.0',
        blockGeneralInternet: true,
        blockWorkstationToWorkstation: false,
        usbPolicy: 'READ_ONLY',
        bluetoothPolicy: 'BLOCKED',
      },
      updatedAt: iso(-60 * 24 * 3),
      updatedByUserId: 'user-exam-admin',
    },
    createdByUserId: 'user-exam-admin',
    createdAt: iso(-60 * 24 * 8),
    updatedAt: iso(-60 * 24 * 3),
    candidateCount: 0,
    manifestId: null,
  };

  // An approved, published examination still ahead of its start time, so the
  // dashboard shows an upcoming, an active and a draft examination.
  const upcomingStart = new Date();
  upcomingStart.setDate(upcomingStart.getDate() + 12);
  upcomingStart.setHours(9, 30, 0, 0);

  const upcoming: Exam = {
    ...published,
    id: 'exam-rasp-2026-03',
    name: 'Regional Aptitude Screening 2026 — Northern Cycle',
    code: 'RASP-2026-03',
    description:
      'Regional screening examination for the northern cycle. Paper approved, signed and encrypted; awaiting its scheduled release window.',
    subject: 'General Aptitude',
    startsAt: upcomingStart.toISOString(),
    durationMinutes: 90,
    reportingTime: '09:00',
    navigationMode: 'FREE',
    centreId: 'centre-north',
    status: 'PUBLISHED',
    blueprint: {
      ...published.blueprint,
      totalQuestions: 40,
      totalMarks: 80,
      difficultyDistribution: { EASY: 16, MEDIUM: 16, DIFFICULT: 8 },
    },
    securityPolicy: {
      ...published.securityPolicy,
      profileId: 'HIGH_ASSURANCE',
      network: {
        ...published.securityPolicy.network,
        centreId: 'centre-north',
        primaryCidr: '10.52.0.0/16',
        backupCidr: null,
        ipv6Cidr: null,
      },
      updatedAt: iso(-60 * 24 * 6),
    },
    createdAt: iso(-60 * 24 * 26),
    updatedAt: iso(-60 * 24 * 6),
    candidateCount: 0,
    manifestId: null,
  };

  void approvedCount;
  db.exams.set(published.id, published);
  db.exams.set(upcoming.id, upcoming);
  db.exams.set(draft.id, draft);
  return { published, upcoming, draft };
}

function seedCandidates(db: Database, exam: Exam): Candidate[] {
  const credential = hashPassword(DEMO_CANDIDATE_PASSWORD);
  const candidates: Candidate[] = [];

  for (let i = 1; i <= 500; i += 1) {
    const applicationId = `NTAE26-${String(i).padStart(6, '0')}`;
    const fullName = syntheticName(i - 1);
    const id = `candidate-${String(i).padStart(4, '0')}`;
    const needsAccommodation = i % 47 === 0;

    const candidate: Candidate = {
      id,
      candidateId: `CND-${String(i).padStart(5, '0')}`,
      applicationId,
      fullName,
      // Neutral generated avatar — no photograph of a real person is used.
      photoSeed: `${fullName.replace(/\s+/g, '-').toLowerCase()}-${i}`,
      email: `${applicationId.toLowerCase()}@candidates.demo`,
      eligibility: i % 97 === 0 ? 'PROVISIONAL' : 'ELIGIBLE',
      examId: exam.id,
      centreId: exam.centreId,
      accommodations: {
        additionalTimeMinutes: needsAccommodation ? 20 : 0,
        requirements: needsAccommodation ? ['Screen magnification', 'Additional time'] : [],
        notes: needsAccommodation ? 'Accommodation approved by the examination controller.' : '',
      },
      fingerprintEnrolled: i % 11 !== 0,
      faceEnrolled: true,
      // Simulated reference identifier only. No raw biometric data is stored.
      biometricReferenceId: `bio-ref-${stableIndex(applicationId, 0xffffff).toString(16)}`,
      accountStatus: 'ACTIVE',
      lastVerificationEvent: null,
    };

    candidates.push(candidate);
    db.candidates.set(candidate.id, candidate);
    db.candidateCredentials.set(candidate.applicationId, {
      candidateId: candidate.id,
      applicationId: candidate.applicationId,
      passwordHash: credential.hash,
      salt: credential.salt,
      demoPassword: DEMO_CANDIDATE_PASSWORD,
    });

    db.registrations.set(`reg-${id}`, {
      id: `reg-${id}`,
      examId: exam.id,
      candidateId: id,
      centreId: exam.centreId,
      seatNumber: `S-${String(Math.ceil(i / 25)).padStart(2, '0')}-${String(((i - 1) % 25) + 1).padStart(2, '0')}`,
      status: 'REGISTERED',
      createdAt: iso(-60 * 24 * 30),
    });
  }

  return candidates;
}

/**
 * Live session mix for the invigilator dashboard. The counts add up to exactly
 * the 500 registered candidates.
 */
const SESSION_MIX: { status: ExamAttempt['status']; count: number }[] = [
  { status: 'NOT_STARTED', count: 22 },
  { status: 'VERIFYING', count: 18 },
  { status: 'ACTIVE', count: 380 },
  { status: 'RESTRICTED', count: 9 },
  { status: 'AWAITING_REVERIFICATION', count: 12 },
  { status: 'DISCONNECTED', count: 28 },
  { status: 'SUBMITTED', count: 31 },
];

function seedAttempts(db: Database, exam: Exam, candidates: Candidate[]): void {
  const approvedDevices = [...db.devices.values()].filter((d) => d.status === 'APPROVED');
  let cursor = 0;
  const examStart = new Date(exam.startsAt);

  for (const bucket of SESSION_MIX) {
    for (let i = 0; i < bucket.count; i += 1) {
      const candidate = candidates[cursor];
      cursor += 1;
      if (!candidate) break;
      // The scripted demo candidate must be able to sign in fresh.
      if (candidate.applicationId === DEMO_CANDIDATE_APPLICATION_ID) continue;
      if (bucket.status === 'NOT_STARTED') continue;

      const device = approvedDevices[cursor % approvedDevices.length];
      const attemptId = `attempt-${candidate.id}`;
      const startedAt = new Date(examStart.getTime() + (cursor % 12) * 60_000);
      const extra = candidate.accommodations.additionalTimeMinutes;
      const expiresAt = new Date(startedAt.getTime() + (exam.durationMinutes + extra) * 60_000);

      const restricted = bucket.status === 'RESTRICTED';
      const review = bucket.status === 'AWAITING_REVERIFICATION';

      const attempt: ExamAttempt = {
        id: attemptId,
        examId: exam.id,
        candidateId: candidate.id,
        deviceId: device?.id ?? 'device-1',
        status: bucket.status,
        startedAt: startedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        submittedAt: bucket.status === 'SUBMITTED' ? iso(-(cursor % 20) - 2) : null,
        assignmentId: null,
        identityStatus: review ? 'WARNING' : restricted ? 'WARNING' : 'VERIFIED',
        connectionStatus:
          bucket.status === 'DISCONNECTED' ? 'OFFLINE' : cursor % 37 === 0 ? 'RECONNECTING' : 'ONLINE',
        consecutiveMonitoringFailures: restricted ? 3 : review ? 2 : 0,
        restrictionReason: restricted
          ? 'Three consecutive presence checks did not detect the candidate. Navigation restricted pending verification.'
          : null,
        alertLevel: restricted ? 'CRITICAL' : review ? 'WARNING' : bucket.status === 'DISCONNECTED' ? 'INFO' : 'NONE',
        lastAnswerSavedAt: iso(-(cursor % 5) - 1),
        additionalTimeMinutes: extra,
        answeredCount: bucket.status === 'SUBMITTED' ? 50 : Math.min(50, 6 + (cursor % 34)),
        flaggedCount: cursor % 7,
        reverificationRequestedAt: review ? iso(-(cursor % 6) - 1) : null,
      };
      db.attempts.set(attempt.id, attempt);

      if (restricted || review) {
        seedProctoringForAttempt(db, attempt, candidate.id, exam.id, restricted ? 3 : 2);
      }
    }
  }
}

function seedProctoringForAttempt(
  db: Database,
  attempt: ExamAttempt,
  candidateId: string,
  examId: string,
  failures: number,
): void {
  let previousHash: string | null = null;
  for (let i = 1; i <= failures; i += 1) {
    const result = i === 2 ? 'MULTIPLE_FACES' : 'NO_FACE_DETECTED';
    const event: ProctoringEvent = {
      id: randomUUID(),
      attemptId: attempt.id,
      candidateId,
      examId,
      sequence: i,
      challengeId: randomUUID(),
      result,
      confidence: 0.4 + i * 0.1,
      capturedAt: iso(-(failures - i) * 2 - 1),
      receivedAt: iso(-(failures - i) * 2 - 1),
      evidenceObjectId: null,
      previousEvidenceHash: previousHash,
      evidenceHash: `${stableIndex(attempt.id + i, 0xffffffff).toString(16).padStart(8, '0')}${stableIndex(
        attempt.id + i + 'b',
        0xffffffff,
      )
        .toString(16)
        .padStart(8, '0')}`,
      severity: i >= 3 ? 'CRITICAL' : 'WARNING',
      reviewedByUserId: null,
      simulated: true,
    };
    previousHash = event.evidenceHash;
    db.proctoringEvents.push(event);
  }
}

function seedIncidents(db: Database, exam: Exam): void {
  const flagged = [...db.attempts.values()].filter(
    (a) => a.status === 'RESTRICTED' || a.status === 'AWAITING_REVERIFICATION',
  );

  const specs: { type: Incident['type']; severity: Incident['severity']; title: string; detail: string }[] = [
    {
      type: 'REPEATED_FACE_ABSENCE',
      severity: 'CRITICAL',
      title: 'Three consecutive presence checks failed',
      detail:
        'The workstation camera did not detect the candidate in three consecutive checks. Question navigation has been restricted and the candidate has been asked to reverify. Answers already saved are unaffected.',
    },
    {
      type: 'MULTIPLE_FACES',
      severity: 'WARNING',
      title: 'More than one face detected',
      detail: 'A presence check detected more than one face in the frame. A second check is queued.',
    },
    {
      type: 'CAMERA_BLOCKED',
      severity: 'WARNING',
      title: 'Camera appears to be blocked',
      detail: 'Several consecutive frames were uniformly dark, which usually means the camera is covered.',
    },
    {
      type: 'DEVICE_HEALTH_FAILURE',
      severity: 'WARNING',
      title: 'Workstation camera reported a fault',
      detail: 'WS-CEC-007 reported a camera failure during its readiness check. The workstation was not allocated.',
    },
    {
      type: 'NETWORK_CHANGE',
      severity: 'INFO',
      title: 'Workstation moved to the backup examination range',
      detail: 'The centre failed over to 10.43.0.0/16. The range is on the approved allowlist, so sessions continued.',
    },
    {
      type: 'UNAPPROVED_WORKSTATION',
      severity: 'CRITICAL',
      title: 'Sign-in attempted from an unregistered workstation',
      detail:
        'A sign-in was attempted from a workstation with no registered device certificate. The attempt was refused before any paper was released.',
    },
    {
      type: 'EXCESSIVE_API_REQUESTS',
      severity: 'WARNING',
      title: 'Request rate limit applied',
      detail: 'A workstation exceeded the answer-save rate limit after a retry loop. Requests were throttled, not dropped.',
    },
  ];

  specs.forEach((spec, index) => {
    const attempt = flagged[index % Math.max(flagged.length, 1)];
    const id = `incident-${index + 1}`;
    const incident: Incident = {
      id,
      type: spec.type,
      severity: spec.severity,
      examId: exam.id,
      centreId: exam.centreId,
      candidateId: index < 3 ? (attempt?.candidateId ?? null) : null,
      attemptId: index < 3 ? (attempt?.id ?? null) : null,
      deviceId: spec.type === 'DEVICE_HEALTH_FAILURE' ? 'device-7' : null,
      title: spec.title,
      detail: spec.detail,
      status: index === 0 ? 'OPEN' : index < 3 ? 'ACKNOWLEDGED' : 'RESOLVED',
      createdAt: iso(-(index + 1) * 9),
      updatedAt: iso(-(index + 1) * 4),
      assignedToUserId: index < 3 ? 'user-invigilator' : null,
      notes:
        index === 0
          ? [
              {
                id: randomUUID(),
                authorUserId: 'user-invigilator',
                authorName: 'Rakesh Menon',
                body: 'Walked to the workstation. Candidate had leaned out of frame to retrieve a dropped pen. Reverification requested.',
                createdAt: iso(-4),
              },
            ]
          : [],
    };
    db.incidents.set(id, incident);
  });
}

function seedAuditHistory(db: Database, exam: Exam): void {
  const entries: Parameters<typeof recordAudit>[0][] = [
    {
      actorId: 'user-exam-admin',
      actorName: 'Nikhil Bhandari',
      actorRole: 'EXAM_ADMIN',
      action: 'EXAM_CREATED',
      targetType: 'Exam',
      targetId: exam.id,
      targetLabel: exam.name,
      reason: 'Annual examination cycle 2026 created from the approved calendar.',
      ipAddress: '10.10.4.21',
      timestamp: iso(-60 * 24 * 45),
    },
    {
      actorId: 'user-question-author',
      actorName: 'Sara Mathew',
      actorRole: 'QUESTION_AUTHOR',
      action: 'QUESTION_SUBMITTED_FOR_REVIEW',
      targetType: 'QuestionBatch',
      targetId: 'batch-2026-01',
      targetLabel: '60 questions submitted for review',
      reason: 'Initial authoring cycle complete.',
      ipAddress: '10.10.4.44',
      timestamp: iso(-60 * 24 * 38),
    },
    {
      actorId: 'user-question-reviewer',
      actorName: 'Dr. Anand Krishnan',
      actorRole: 'QUESTION_REVIEWER',
      action: 'QUESTION_APPROVED',
      targetType: 'QuestionBatch',
      targetId: 'batch-2026-01',
      targetLabel: '50 questions approved for assembly',
      reason: 'Content, keys and marks verified against the blueprint.',
      ipAddress: '10.10.4.51',
      timestamp: iso(-60 * 24 * 34),
    },
    {
      actorId: 'user-security-admin',
      actorName: 'Farida Qureshi',
      actorRole: 'SECURITY_ADMIN',
      action: 'SECURITY_POLICY_MODIFIED',
      targetType: 'Exam',
      targetId: exam.id,
      targetLabel: exam.name,
      reason: 'Maximum Assurance profile applied for the controlled-premise centre.',
      ipAddress: '10.10.4.77',
      timestamp: iso(-60 * 24 * 12),
    },
  ];
  entries.forEach(recordAudit);
}

/* ------------------------------------------------------------------ */

export interface SeedResult {
  exam: Exam;
  draftExam: Exam;
  manifestId: string;
  candidateCount: number;
  questionCount: number;
}

export async function seedDatabase(): Promise<SeedResult> {
  // A fresh key provider per seed keeps signatures consistent with the manifest.
  __setKeyProvider(null);
  const db = emptyDatabase();
  replaceDb(db);

  seedCentres(db);
  seedDevices(db);
  seedUsers(db);
  const { approvedVersions } = seedQuestions(db);
  const { published, upcoming, draft } = buildExams(db, approvedVersions.length);

  db.examQuestions.set(published.id, new Set(db.questions.keys()));
  db.examQuestions.set(draft.id, new Set(approvedVersions.slice(0, draft.blueprint.totalQuestions).map(v => v.questionId)));
  db.examQuestions.set(upcoming.id, new Set(approvedVersions.slice(0, upcoming.blueprint.totalQuestions).map(v => v.questionId)));
  // Assemble, sign and encrypt the published paper.
  const paperVersions = approvedVersions.slice(0, published.blueprint.totalQuestions);
  for (const seededExam of [published, upcoming, draft]) {
    const selectedVersions = approvedVersions.slice(0, seededExam.blueprint.totalQuestions);
    const allocations = [...db.categories.values()].map(category => {
    const questions = selectedVersions.filter(v => v.categoryId === category.id);
    return { categoryId: category.id, categoryCode: category.code, categoryName: category.name,
      questionCount: questions.length, marksPerQuestion: category.marksPerQuestion,
      negativeMarksPerQuestion: category.negativeMarksPerQuestion,
      totalMarks: questions.length * category.marksPerQuestion,
      difficultyMix: { EASY: questions.filter(v => v.difficulty === 'EASY').length,
        MEDIUM: questions.filter(v => v.difficulty === 'MEDIUM').length,
        DIFFICULT: questions.filter(v => v.difficulty === 'DIFFICULT').length } };
  }).filter(a => a.questionCount > 0);
  seededExam.blueprint.categoryAllocations = allocations;
  seededExam.blueprint.totalMarks = allocations.reduce((n, a) => n + a.totalMarks, 0);
  seededExam.blueprint.difficultyDistribution = {
    EASY: allocations.reduce((n, a) => n + a.difficultyMix.EASY, 0),
    MEDIUM: allocations.reduce((n, a) => n + a.difficultyMix.MEDIUM, 0),
    DIFFICULT: allocations.reduce((n, a) => n + a.difficultyMix.DIFFICULT, 0),
  };
    seededExam.blueprint.subjectDistribution = [...new Set(selectedVersions.map(v => v.subject))].map(subject => ({ subject, count: selectedVersions.filter(v => v.subject === subject).length }));
  }
  const { manifest, envelope } = await sealPaper({
    exam: published,
    versions: paperVersions,
    createdByUserId: 'user-exam-admin',
    examVersion: 1,
  });
  manifest.publicationStatus = 'PUBLISHED';
  db.manifests.set(manifest.id, manifest);
  db.sealedPackages.set(manifest.id, { manifestId: manifest.id, envelope });
  published.manifestId = manifest.id;

  paperVersions.forEach((version) => {
    version.status = 'PUBLISHED';
    version.immutable = true;
    const question = db.questions.get(version.questionId);
    if (question) question.status = 'PUBLISHED';
  });

  // Dual approval, recorded by two different people.
  [
    { userId: 'user-question-reviewer', name: 'Dr. Anand Krishnan', role: 'QUESTION_REVIEWER' as const },
    { userId: 'user-security-admin', name: 'Farida Qureshi', role: 'SECURITY_ADMIN' as const },
  ].forEach((approver, index) => {
    const id = `approval-${index + 1}`;
    db.publicationApprovals.set(id, {
      id,
      manifestId: manifest.id,
      examId: published.id,
      approverUserId: approver.userId,
      approverName: approver.name,
      approverRole: approver.role,
      decision: 'APPROVED',
      comment:
        index === 0
          ? 'Question content and marking scheme verified against the approved blueprint.'
          : 'Release policy, key reference and centre network policy verified.',
      createdAt: iso(-60 * 24 * 10 + index * 30),
    });
  });

  // The upcoming examination gets its own sealed paper and approvals.
  const upcomingVersions = approvedVersions.slice(0, upcoming.blueprint.totalQuestions);
  if (upcomingVersions.length === upcoming.blueprint.totalQuestions) {
    const sealed = await sealPaper({
      exam: upcoming,
      versions: upcomingVersions,
      createdByUserId: 'user-exam-admin',
      examVersion: 1,
    });
    sealed.manifest.publicationStatus = 'PUBLISHED';
    db.manifests.set(sealed.manifest.id, sealed.manifest);
    db.sealedPackages.set(sealed.manifest.id, { manifestId: sealed.manifest.id, envelope: sealed.envelope });
    upcoming.manifestId = sealed.manifest.id;
    [
      { userId: 'user-question-reviewer', name: 'Dr. Anand Krishnan', role: 'QUESTION_REVIEWER' as const },
      { userId: 'user-security-admin', name: 'Farida Qureshi', role: 'SECURITY_ADMIN' as const },
    ].forEach((approver, index) => {
      const id = `approval-upcoming-${index + 1}`;
      db.publicationApprovals.set(id, {
        id,
        manifestId: sealed.manifest.id,
        examId: upcoming.id,
        approverUserId: approver.userId,
        approverName: approver.name,
        approverRole: approver.role,
        decision: 'APPROVED',
        comment:
          index === 0
            ? 'Blueprint coverage and marking scheme verified for the northern cycle.'
            : 'Centre network policy and release window verified.',
        createdAt: iso(-60 * 24 * 6 + index * 25),
      });
    });
  }

  const candidates = seedCandidates(db, published);

  // Candidates 301–500 are also registered for the upcoming northern screening.
  candidates.slice(300).forEach((candidate, index) => {
    const id = `reg-upcoming-${candidate.id}`;
    db.registrations.set(id, {
      id,
      examId: upcoming.id,
      candidateId: candidate.id,
      centreId: upcoming.centreId,
      seatNumber: `N-${String(Math.ceil((index + 1) / 20)).padStart(2, '0')}-${String((index % 20) + 1).padStart(2, '0')}`,
      status: 'REGISTERED',
      createdAt: iso(-60 * 24 * 20),
    });
  });
  upcoming.candidateCount = 200;

  seedAttempts(db, published, candidates);
  seedIncidents(db, published);
  seedAuditHistory(db, published);

  recordAudit({
    actorId: 'user-exam-admin',
    actorName: 'Nikhil Bhandari',
    actorRole: 'EXAM_ADMIN',
    action: 'PAPER_ASSEMBLED',
    targetType: 'ExamManifest',
    targetId: manifest.id,
    targetLabel: `${published.code} manifest v1`,
    reason: `${manifest.entries.length} approved questions fingerprinted and assembled.`,
    ipAddress: '10.10.4.21',
    timestamp: iso(-60 * 24 * 11),
  });
  recordAudit({
    actorId: 'user-security-admin',
    actorName: 'Farida Qureshi',
    actorRole: 'SECURITY_ADMIN',
    action: 'EXAM_PUBLISHED',
    targetType: 'ExamManifest',
    targetId: manifest.id,
    targetLabel: `${published.code} manifest v1`,
    reason: 'Dual approval complete. Encrypted paper marked ready for timed release.',
    ipAddress: '10.10.4.77',
    timestamp: iso(-60 * 24 * 10),
  });

  // Historical operational events so the audit report is not empty.
  [...db.attempts.values()].slice(0, 40).forEach((attempt, index) => {
    const candidate = db.candidates.get(attempt.candidateId);
    if (!candidate) return;
    recordAudit({
      actorId: candidate.id,
      actorName: candidate.fullName,
      actorRole: 'CANDIDATE',
      action: 'ATTEMPT_ACTIVATED',
      targetType: 'ExamAttempt',
      targetId: attempt.id,
      targetLabel: `${published.code} / ${candidate.applicationId}`,
      reason: 'Identity, device, network and eligibility checks passed.',
      deviceId: attempt.deviceId,
      ipAddress: `10.42.10.${11 + (index % 24)}`,
      timestamp: attempt.startedAt ?? iso(-60),
    });
  });

  return {
    exam: published,
    draftExam: draft,
    manifestId: manifest.id,
    candidateCount: candidates.length,
    questionCount: db.questions.size,
  };
}

export function currentSeedSummary() {
  const db = getDb();
  return {
    exams: db.exams.size,
    questions: db.questions.size,
    candidates: db.candidates.size,
    devices: db.devices.size,
    attempts: db.attempts.size,
    auditEvents: db.auditEvents.length,
  };
}
