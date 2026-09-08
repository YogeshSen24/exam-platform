import { defaultVerificationPolicy, type QuestionCategory } from '@sep/shared';
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Network,
  ShieldCheck,
  Sparkles,
  Upload,
  UserSquare2,
} from 'lucide-react';
import {
  blueprintSchema,
  effectiveControls,
  examBasicsSchema,
  monitoringPolicySchema,
  networkPolicySchema,
  NAVIGATION_MODE_HELP,
  NAVIGATION_MODE_LABELS,
  RESULT_MODE_LABELS,
  SECURITY_PROFILE_DEFINITIONS,
  SECURITY_PROFILES,
  SUBJECTS,
  type BlueprintInput,
  type ExamBasicsInput,
  type MonitoringPolicyInput,
  type NetworkPolicyInput,
  type SecurityProfileId,
} from '@sep/shared';
import { api, ApiError } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/Card';
import { Checkbox, Field, RadioCardGroup, Select, TextArea, TextInput, Toggle } from '@/components/ui/Form';
import { Alert, EmptyState } from '@/components/ui/Feedback';
import { DescriptionList, ProgressBar, Stepper, useToast } from '@/components/ui/Misc';
import { StatusPill } from '@/components/ui/Status';
import { InfoPanel } from '@/components/ui/Explain';
import { SecurityControlList } from '@/components/domain/SecurityControlList';

const STEPS = [
  { id: 1, label: 'Basic information', short: 'Basics' },
  { id: 2, label: 'Question blueprint', short: 'Blueprint' },
  { id: 3, label: 'Candidates', short: 'Candidates' },
  { id: 4, label: 'Security policy', short: 'Security' },
  { id: 5, label: 'Monitoring', short: 'Monitoring' },
  { id: 6, label: 'Network and devices', short: 'Network' },
  { id: 7, label: 'Review and create', short: 'Review' },
];

interface Centre {
  id: string;
  name: string;
  code: string;
  city: string;
  primaryCidr: string;
  backupCidr: string | null;
  ipv6Cidr: string | null;
  status: string;
}

const TIME_ZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Europe/London', 'UTC', 'America/New_York'];

export function ExamWizardPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<ApiError | null>(null);

  const centres = useQuery({
    queryKey: ['centres'],
    queryFn: () => api.get<{ items: Centre[] }>('/centres'),
  });

  const [basics, setBasics] = useState<ExamBasicsInput>({
    name: '',
    code: '',
    description: '',
    subject: SUBJECTS[0],
    startsAt: defaultStart(),
    durationMinutes: 120,
    reportingTime: '08:30',
    navigationMode: 'FREE',
    resultMode: 'AFTER_REVIEW',
    centreId: '',
    timeZone: 'Asia/Kolkata',
  });

  const [blueprint, setBlueprint] = useState<BlueprintInput>({
    categoryAllocations: [],
    totalQuestions: 0,
    totalMarks: 0,
    difficultyDistribution: { EASY: 0, MEDIUM: 0, DIFFICULT: 0 },
    subjectDistribution: [],
    mandatoryQuestionIds: [],
    randomPools: [],
    negativeMarking: true,
    negativeMarkValue: 0.5,
    randomizeQuestionOrder: true,
    randomizeOptionOrder: true,
  });

  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get<{ items: QuestionCategory[] }>('/categories') });
  function allocate(category: QuestionCategory, level: 'EASY' | 'MEDIUM' | 'DIFFICULT', count: number) {
    setBlueprint(previous => {
      const old = previous.categoryAllocations.find(a => a.categoryId === category.id);
      const mix = { ...(old?.difficultyMix ?? { EASY: 0, MEDIUM: 0, DIFFICULT: 0 }), [level]: Math.max(0, count || 0) };
      const questionCount = mix.EASY + mix.MEDIUM + mix.DIFFICULT;
      const allocations = [...previous.categoryAllocations.filter(a => a.categoryId !== category.id), {
        categoryId: category.id, categoryCode: category.code, categoryName: category.name,
        questionCount, marksPerQuestion: category.marksPerQuestion, negativeMarksPerQuestion: category.negativeMarksPerQuestion,
        difficultyMix: mix, totalMarks: questionCount * category.marksPerQuestion,
      }].filter(a => a.questionCount > 0);
      return { ...previous, categoryAllocations: allocations,
        totalQuestions: allocations.reduce((n, a) => n + a.questionCount, 0),
        totalMarks: allocations.reduce((n, a) => n + a.totalMarks, 0),
        difficultyDistribution: {
          EASY: allocations.reduce((n, a) => n + a.difficultyMix.EASY, 0),
          MEDIUM: allocations.reduce((n, a) => n + a.difficultyMix.MEDIUM, 0),
          DIFFICULT: allocations.reduce((n, a) => n + a.difficultyMix.DIFFICULT, 0),
        },
      };
    });
  }
  const [requireNative, setRequireNative] = useState(false);
  const [requireSeat, setRequireSeat] = useState(false);
  const [fingerprintEnabled, setFingerprintEnabled] = useState(true);
  const [faceEnabled, setFaceEnabled] = useState(true);
  const [profileId, setProfileId] = useState<SecurityProfileId>('MAXIMUM_ASSURANCE');

  const [monitoring, setMonitoring] = useState<MonitoringPolicyInput>({
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
      'During this examination the workstation camera takes a low-resolution photograph at regular intervals to confirm that you are present and alone. Images are used only to confirm presence and identity for this examination, are reviewed only by authorised examination staff, and are deleted at the end of the retention period.',
  });

  const [network, setNetwork] = useState<NetworkPolicyInput>({
    centreId: '',
    primaryCidr: '10.42.0.0/16',
    backupCidr: '10.43.0.0/16',
    ipv6Cidr: null,
    deviceCertificateRequired: true,
    minimumDevicePolicyVersion: '2026.01.0',
    blockGeneralInternet: true,
    blockWorkstationToWorkstation: true,
    usbPolicy: 'BLOCKED',
    bluetoothPolicy: 'BLOCKED',
  });

  const profile = SECURITY_PROFILE_DEFINITIONS[profileId];
  const controls = useMemo(() => effectiveControls(profileId), [profileId]);

  const difficultyTotal =
    blueprint.difficultyDistribution.EASY +
    blueprint.difficultyDistribution.MEDIUM +
    blueprint.difficultyDistribution.DIFFICULT;

  const warnings = useMemo(() => {
    const list: string[] = [];
    if (difficultyTotal !== blueprint.totalQuestions) {
      list.push(
        `The difficulty distribution adds up to ${difficultyTotal} but the blueprint requires ${blueprint.totalQuestions} questions.`,
      );
    }
    if (monitoring.cameraMonitoringEnabled && monitoring.snapshotIntervalSeconds <= 15) {
      list.push(
        'A short snapshot interval increases bandwidth, storage use and privacy impact. Consider 30 seconds unless a shorter interval is genuinely required.',
      );
    }
    if (profile.flags.ipAllowlist && !network.backupCidr) {
      list.push('No backup network range is configured. A single network fault would stop the examination.');
    }
    if (!profile.flags.dualApprovalBeforePublication) {
      list.push('This profile allows a single approver to publish the paper.');
    }
    return list;
  }, [
    difficultyTotal,
    blueprint.totalQuestions,
    monitoring.cameraMonitoringEnabled,
    monitoring.snapshotIntervalSeconds,
    profile.flags.ipAllowlist,
    profile.flags.dualApprovalBeforePublication,
    network.backupCidr,
  ]);

  const readiness = useMemo(() => {
    const checks = [
      Boolean(basics.name && basics.code && basics.centreId),
      blueprint.totalQuestions > 0 && difficultyTotal === blueprint.totalQuestions,
      Boolean(profileId),
      !monitoring.cameraMonitoringEnabled || monitoring.candidateNotice.length >= 20,
      Boolean(network.primaryCidr),
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [basics, blueprint.totalQuestions, difficultyTotal, profileId, monitoring, network]);

  const create = useMutation({
    mutationFn: () =>
      api.post<{ exam: { id: string; name: string } }>('/exams', {
        basics: { ...basics, startsAt: new Date(basics.startsAt).toISOString() },
        blueprint,
        candidateIds: [],
        securityProfileId: profileId,
        verification: { ...defaultVerificationPolicy(profileId), requireNativeClient: requireNative, requireAssignedDevice: requireSeat,
          fingerprint: { ...defaultVerificationPolicy(profileId).fingerprint, enabled: fingerprintEnabled },
          face: { ...defaultVerificationPolicy(profileId).face, enabled: faceEnabled } },
        monitoring,
        network: { ...network, centreId: basics.centreId },
      }),
    onSuccess: (data) => {
      toast.push({
        tone: 'success',
        title: 'Examination created',
        description: `${data.exam.name} is in draft. Add candidates and questions from its workspace.`,
      });
      navigate(`/admin/exams/${data.exam.id}`);
    },
    onError: (error) => {
      if (error instanceof ApiError) setSubmitError(error);
    },
  });

  function validateStep(target: number): boolean {
    const next: Record<string, string> = {};
    if (target > 1) {
      const result = examBasicsSchema.safeParse(basics);
      if (!result.success) {
        result.error.issues.forEach((issue) => {
          next[String(issue.path[0])] = issue.message;
        });
      }
    }
    if (target > 2) {
      const result = blueprintSchema.safeParse(blueprint);
      if (!result.success) {
        result.error.issues.forEach((issue) => {
          next[`blueprint.${String(issue.path[0])}`] = issue.message;
        });
      }
    }
    if (target > 5) {
      const result = monitoringPolicySchema.safeParse(monitoring);
      if (!result.success) {
        result.error.issues.forEach((issue) => {
          next[`monitoring.${String(issue.path[0])}`] = issue.message;
        });
      }
    }
    if (target > 6) {
      const result = networkPolicySchema.safeParse({ ...network, centreId: basics.centreId });
      if (!result.success) {
        result.error.issues.forEach((issue) => {
          next[`network.${String(issue.path[0])}`] = issue.message;
        });
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function goTo(target: number) {
    if (target > step && !validateStep(target)) return;
    setStep(target);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const centreList = (centres.data?.items ?? []).filter((c) => c.status === 'ACTIVE');

  return (
    <div>
      <PageHeader
        title="Create examination"
        description="Seven steps: schedule, blueprint, candidates, security profile, monitoring, network policy, then review."
        breadcrumb={
          <button type="button" onClick={() => navigate('/admin/exams')} className="hover:text-brand hover:underline">
            ← Back to examinations
          </button>
        }
      />

      <div className="mb-6 rounded-card border border-line bg-white px-5 py-4">
        <Stepper steps={STEPS} current={step} onStepClick={goTo} />
        <div className="mt-4 max-w-md">
          <ProgressBar label="Setup readiness" value={readiness} tone={readiness === 100 ? 'success' : 'brand'} />
        </div>
      </div>

      {/* ---------------------------- Step 1 --------------------------- */}
      {step === 1 ? (
        <Card>
          <CardHeader title="Basic information" description="Schedule, centre and how candidates move through the paper." />
          <CardBody className="grid gap-5 sm:grid-cols-2">
            <Field label="Examination name" htmlFor="name" required error={errors.name} className="sm:col-span-2">
              <TextInput
                id="name"
                value={basics.name}
                invalid={Boolean(errors.name)}
                placeholder="National Technical Aptitude Examination 2026"
                onChange={(event) => setBasics({ ...basics, name: event.target.value })}
              />
            </Field>

            <Field
              label="Examination code"
              htmlFor="code"
              required
              error={errors.code}
              hint="Appears on admit cards. Capital letters, numbers and hyphens."
            >
              <TextInput
                id="code"
                value={basics.code}
                invalid={Boolean(errors.code)}
                placeholder="NTAE-2026-01"
                onChange={(event) => setBasics({ ...basics, code: event.target.value.toUpperCase() })}
              />
            </Field>

            <Field label="Subject" htmlFor="subject" required error={errors.subject}>
              <Select
                id="subject"
                value={basics.subject}
                onChange={(event) => setBasics({ ...basics, subject: event.target.value })}
              >
                {SUBJECTS.map((subject) => (
                  <option key={subject} value={subject}>
                    {subject}
                  </option>
                ))}
                <option value="General Aptitude">General Aptitude</option>
              </Select>
            </Field>

            <Field label="Description" htmlFor="description" className="sm:col-span-2" error={errors.description}>
              <TextArea
                id="description"
                rows={3}
                value={basics.description}
                placeholder="Purpose of the examination and anything centre staff should know."
                onChange={(event) => setBasics({ ...basics, description: event.target.value })}
              />
            </Field>

            <Field label="Start date and time" htmlFor="startsAt" required error={errors.startsAt}>
              <TextInput
                id="startsAt"
                type="datetime-local"
                value={basics.startsAt}
                invalid={Boolean(errors.startsAt)}
                onChange={(event) => setBasics({ ...basics, startsAt: event.target.value })}
              />
            </Field>

            <Field label="Duration (minutes)" htmlFor="duration" required error={errors.durationMinutes}>
              <TextInput
                id="duration"
                type="number"
                min={10}
                max={480}
                value={basics.durationMinutes}
                invalid={Boolean(errors.durationMinutes)}
                onChange={(event) => setBasics({ ...basics, durationMinutes: Number(event.target.value) })}
              />
            </Field>

            <Field
              label="Candidate reporting time"
              htmlFor="reporting"
              required
              error={errors.reportingTime}
              hint="When candidates must arrive at the centre."
            >
              <TextInput
                id="reporting"
                type="time"
                value={basics.reportingTime}
                onChange={(event) => setBasics({ ...basics, reportingTime: event.target.value })}
              />
            </Field>

            <Field label="Time zone" htmlFor="timezone" required error={errors.timeZone}>
              <Select
                id="timezone"
                value={basics.timeZone}
                onChange={(event) => setBasics({ ...basics, timeZone: event.target.value })}
              >
                {TIME_ZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Examination centre" htmlFor="centre" required error={errors.centreId} className="sm:col-span-2">
              <Select
                id="centre"
                value={basics.centreId}
                invalid={Boolean(errors.centreId)}
                onChange={(event) => {
                  const centre = centreList.find((c) => c.id === event.target.value);
                  setBasics({ ...basics, centreId: event.target.value });
                  if (centre) {
                    setNetwork((current) => ({
                      ...current,
                      centreId: centre.id,
                      primaryCidr: centre.primaryCidr,
                      backupCidr: centre.backupCidr,
                      ipv6Cidr: centre.ipv6Cidr,
                    }));
                  }
                }}
              >
                <option value="">Select a centre</option>
                {centreList.map((centre) => (
                  <option key={centre.id} value={centre.id}>
                    {centre.name} — {centre.city} ({centre.code})
                  </option>
                ))}
              </Select>
            </Field>

            <div className="sm:col-span-2">
              <p className="mb-2 text-support font-medium text-ink">Question navigation</p>
              <RadioCardGroup
                name="Question navigation"
                value={basics.navigationMode}
                onChange={(value) => setBasics({ ...basics, navigationMode: value })}
                columns={3}
                options={(['FREE', 'SEQUENTIAL', 'SECTION_BASED'] as const).map((mode) => ({
                  value: mode,
                  label: NAVIGATION_MODE_LABELS[mode],
                  description: NAVIGATION_MODE_HELP[mode],
                }))}
              />
            </div>

            <Field label="Result release" htmlFor="resultMode" className="sm:col-span-2">
              <Select
                id="resultMode"
                value={basics.resultMode}
                onChange={(event) =>
                  setBasics({ ...basics, resultMode: event.target.value as ExamBasicsInput['resultMode'] })
                }
              >
                {(['IMMEDIATE', 'AFTER_REVIEW', 'SCHEDULED'] as const).map((mode) => (
                  <option key={mode} value={mode}>
                    {RESULT_MODE_LABELS[mode]}
                  </option>
                ))}
              </Select>
            </Field>
          </CardBody>
          <WizardFooter step={step} onBack={() => navigate('/admin/exams')} onNext={() => goTo(2)} backLabel="Cancel" />
        </Card>
      ) : null}

      {/* ---------------------------- Step 2 --------------------------- */}
      {step === 2 ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader title="Question blueprint" description="How many questions, of what difficulty, worth how much." />
            <CardBody className="space-y-6">
              <div className="space-y-4">
                <p>Allocate questions by category and difficulty. Marks are calculated from each category.</p>
                {(categories.data?.items ?? []).map(category => <div key={category.id} className="rounded-card border border-line p-4">
                  <p className="font-medium">{category.code} — {category.name} · {category.marksPerQuestion} marks each</p>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    {(['EASY', 'MEDIUM', 'DIFFICULT'] as const).map(level => <Field key={level} label={level} htmlFor={`${category.id}-${level}`}>
                      <TextInput id={`${category.id}-${level}`} type="number" min={0} max={300}
                        value={blueprint.categoryAllocations.find(a => a.categoryId === category.id)?.difficultyMix[level] ?? 0}
                        onChange={event => allocate(category, level, Number(event.target.value))} />
                    </Field>)}
                  </div>
                </div>)}
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Total questions" htmlFor="totalQuestions" required>
                  <TextInput
                    id="totalQuestions" readOnly
                    type="number"
                    min={1}
                    value={blueprint.totalQuestions}
                    onChange={(event) => setBlueprint({ ...blueprint, totalQuestions: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Total marks" htmlFor="totalMarks" required>
                  <TextInput
                    id="totalMarks" readOnly
                    type="number"
                    min={1}
                    value={blueprint.totalMarks}
                    onChange={(event) => setBlueprint({ ...blueprint, totalMarks: Number(event.target.value) })}
                  />
                </Field>
              </div>

              <div>
                <p className="text-support font-medium text-ink">Difficulty distribution</p>
                <p className="mt-1 text-meta text-muted">
                  These must add up to the total number of questions.
                </p>
                <div className="mt-3 grid gap-4 sm:grid-cols-3">
                  {(['EASY', 'MEDIUM', 'DIFFICULT'] as const).map((level) => (
                    <Field key={level} label={level.charAt(0) + level.slice(1).toLowerCase()} htmlFor={`d-${level}`}>
                      <TextInput
                        id={`d-${level}`} readOnly
                        type="number"
                        min={0}
                        value={blueprint.difficultyDistribution[level]}
                        onChange={(event) =>
                          setBlueprint({
                            ...blueprint,
                            difficultyDistribution: {
                              ...blueprint.difficultyDistribution,
                              [level]: Number(event.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                  ))}
                </div>
                {difficultyTotal !== blueprint.totalQuestions ? (
                  <Alert tone="warning" className="mt-3" title="Distribution does not match the total">
                    The difficulty counts add up to {difficultyTotal}, but the blueprint requires{' '}
                    {blueprint.totalQuestions} questions.
                  </Alert>
                ) : (
                  <Alert tone="success" className="mt-3" title="Distribution matches the total">
                    {blueprint.difficultyDistribution.EASY} easy, {blueprint.difficultyDistribution.MEDIUM} medium and{' '}
                    {blueprint.difficultyDistribution.DIFFICULT} difficult questions.
                  </Alert>
                )}
              </div>

              <div className="space-y-4 rounded-card border border-line bg-page px-4 py-4">
                <Toggle
                  checked={blueprint.negativeMarking}
                  onChange={(value) => setBlueprint({ ...blueprint, negativeMarking: value })}
                  label="Negative marking"
                  description="Deduct marks for an incorrect answer."
                />
                {blueprint.negativeMarking && <p className="text-support text-muted">The category's negative marks apply to each incorrect answer. Descriptive questions have no negative marks.</p>}
                <Toggle
                  checked={blueprint.randomizeQuestionOrder}
                  onChange={(value) => setBlueprint({ ...blueprint, randomizeQuestionOrder: value })}
                  label="Randomise question order"
                  description="Each candidate receives the same questions in a different order. The order is generated once and replayed after any reconnection."
                />
                <Toggle
                  checked={blueprint.randomizeOptionOrder}
                  onChange={(value) => setBlueprint({ ...blueprint, randomizeOptionOrder: value })}
                  label="Randomise option order"
                  description="Answer options are shuffled per candidate, so option letters cannot be shared."
                />
              </div>

              <p className="text-support text-muted">The paper draws approved questions from the categories and difficulty levels allocated above.</p>
            </CardBody>
            <WizardFooter step={step} onBack={() => goTo(1)} onNext={() => goTo(3)} />
          </Card>

          <Card as="aside" className="h-fit">
            <CardHeader icon={<Sparkles aria-hidden className="h-5 w-5" />} title="Blueprint summary" />
            <CardBody className="space-y-4">
              <DescriptionList
                columns={1}
                items={[
                  { term: 'Total questions', value: <span className="tnum">{blueprint.totalQuestions}</span> },
                  { term: 'Total marks', value: <span className="tnum">{blueprint.totalMarks}</span> },
                  {
                    term: 'Average marks per question',
                    value: (
                      <span className="tnum">
                        {blueprint.totalQuestions > 0
                          ? (blueprint.totalMarks / blueprint.totalQuestions).toFixed(2)
                          : '—'}
                      </span>
                    ),
                  },
                  {
                    term: 'Negative marking',
                    value: blueprint.negativeMarking ? 'As specified by each category' : 'Off',
                  },
                  {
                    term: 'Randomisation',
                    value: [
                      blueprint.randomizeQuestionOrder ? 'Question order' : null,
                      blueprint.randomizeOptionOrder ? 'Option order' : null,
                    ]
                      .filter(Boolean)
                      .join(' and ') || 'None',
                  },
                ]}
              />
              <div className="space-y-2">
                {(['EASY', 'MEDIUM', 'DIFFICULT'] as const).map((level) => (
                  <ProgressBar
                    key={level}
                    label={`${level.charAt(0)}${level.slice(1).toLowerCase()} — ${blueprint.difficultyDistribution[level]} questions`}
                    value={blueprint.difficultyDistribution[level]}
                    max={blueprint.totalQuestions || 1}
                    tone={level === 'EASY' ? 'success' : level === 'MEDIUM' ? 'brand' : 'warning'}
                    showValue={false}
                  />
                ))}
              </div>
            </CardBody>
          </Card>
        </div>
      ) : null}

      {/* Candidates are added after creation, inside the examination workspace. */}
      {step === 3 && <Card><CardHeader title="Candidate registration" description="Each examination has its own candidate register." />
        <CardBody><p className="text-body text-muted">Create this examination first, then open its Candidates tab to add candidates or import a CSV. Workstation assignments are managed there too.</p></CardBody>
        <WizardFooter step={step} onBack={() => goTo(2)} onNext={() => goTo(4)} />
      </Card>}

      {/* ---------------------------- Step 4 --------------------------- */}
      {step === 4 ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader
              icon={<ShieldCheck aria-hidden className="h-5 w-5" />}
              title="Security policy"
              description="Choose an assurance level. The platform selects the cryptographic mechanisms — administrators never pick algorithms directly."
            />
            <CardBody className="space-y-5">
              <InfoPanel title="Recommended for an organisation-controlled centre">
                {SECURITY_PROFILE_DEFINITIONS.MAXIMUM_ASSURANCE.recommendedFor}
              </InfoPanel>

              <div className="mb-5 space-y-3">
                  <label className="block"><input type="checkbox" checked={fingerprintEnabled} onChange={e => setFingerprintEnabled(e.target.checked)} /> Fingerprint verification</label>
                  <label className="block"><input type="checkbox" checked={faceEnabled} onChange={e => setFaceEnabled(e.target.checked)} /> Face verification</label>
                  <label className="block"><input type="checkbox" checked={requireSeat} onChange={e => setRequireSeat(e.target.checked)} /> Require an assigned workstation (import seat assignments before candidates start)</label>
                  <label className="block"><input type="checkbox" checked={requireNative} onChange={e => setRequireNative(e.target.checked)} /> Require the managed Windows client (blocks browser candidates)</label>
                </div>
                <RadioCardGroup
                name="Security profile"
                value={profileId}
                onChange={(value) => {
                  setProfileId(value);
                  const flags = SECURITY_PROFILE_DEFINITIONS[value].flags;
                  setMonitoring((current) => ({
                    ...current,
                    cameraMonitoringEnabled: flags.periodicFacePresence || flags.requireFaceVerificationAtLogin,
                    loginSnapshotEnabled: flags.requireFaceVerificationAtLogin,
                    facePresenceDetection: flags.periodicFacePresence,
                    identityComparison: flags.periodicFacePresence,
                    humanReviewRequired: flags.invigilatorReviewWorkflow,
                    reverificationMode: flags.invigilatorReviewWorkflow ? 'INVIGILATOR_APPROVED' : 'AUTOMATIC',
                  }));
                  setNetwork((current) => ({
                    ...current,
                    deviceCertificateRequired: flags.deviceCertificateRequired,
                    blockGeneralInternet: flags.controlledExamNetwork,
                    blockWorkstationToWorkstation: flags.controlledExamNetwork,
                  }));
                }}
                options={SECURITY_PROFILES.map((id) => ({
                  value: id,
                  label: SECURITY_PROFILE_DEFINITIONS[id].name,
                  description: SECURITY_PROFILE_DEFINITIONS[id].summary,
                  badge:
                    id === 'MAXIMUM_ASSURANCE' ? (
                      <StatusPill tone="brand" size="sm">
                        Recommended
                      </StatusPill>
                    ) : undefined,
                }))}
              />
            </CardBody>
            <WizardFooter step={step} onBack={() => goTo(3)} onNext={() => goTo(5)} />
          </Card>

          <Card as="aside" className="h-fit">
            <CardHeader
              title={`Effective controls — ${profile.name}`}
              description={`${controls.length} controls apply when this profile is selected.`}
            />
            <CardBody>
              <SecurityControlList controls={controls} />
            </CardBody>
          </Card>
        </div>
      ) : null}

      {/* ---------------------------- Step 5 --------------------------- */}
      {step === 5 ? (
        <Card>
          <CardHeader
            icon={<Camera aria-hidden className="h-5 w-5" />}
            title="Monitoring settings"
            description="Camera-presence monitoring is optional and is governed entirely by this policy."
          />
          <CardBody className="space-y-6">
            <div className="space-y-4 rounded-card border border-line bg-page px-4 py-4">
              <Toggle
                checked={monitoring.cameraMonitoringEnabled}
                onChange={(value) => setMonitoring({ ...monitoring, cameraMonitoringEnabled: value })}
                label="Camera monitoring during the examination"
                description="Takes a low-resolution photograph at the interval below to confirm the candidate is present and alone."
              />
              <Toggle
                checked={monitoring.loginSnapshotEnabled}
                onChange={(value) => setMonitoring({ ...monitoring, loginSnapshotEnabled: value })}
                label="Photograph at sign-in"
                description="A single capture compared with the enrolment photograph on the candidate record."
              />
            </div>

            {monitoring.cameraMonitoringEnabled ? (
              <>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field
                    label="Snapshot interval"
                    htmlFor="interval"
                    hint="Shorter intervals increase bandwidth, storage use and privacy impact."
                  >
                    <Select
                      id="interval"
                      value={String(monitoring.snapshotIntervalSeconds)}
                      onChange={(event) =>
                        setMonitoring({
                          ...monitoring,
                          snapshotIntervalSeconds: Number(event.target.value) as 10 | 15 | 30 | 60,
                        })
                      }
                    >
                      <option value="10">Every 10 seconds</option>
                      <option value="15">Every 15 seconds</option>
                      <option value="30">Every 30 seconds (recommended)</option>
                      <option value="60">Every 60 seconds</option>
                    </Select>
                  </Field>

                  <Field
                    label="Consecutive failures before restriction"
                    htmlFor="threshold"
                    hint="Navigation is paused after this many failures in a row. Answers are never discarded."
                  >
                    <TextInput
                      id="threshold"
                      type="number"
                      min={1}
                      max={10}
                      value={monitoring.consecutiveFailureThreshold}
                      onChange={(event) =>
                        setMonitoring({ ...monitoring, consecutiveFailureThreshold: Number(event.target.value) })
                      }
                    />
                  </Field>

                  <Field label="Reverification" htmlFor="reverification">
                    <Select
                      id="reverification"
                      value={monitoring.reverificationMode}
                      onChange={(event) =>
                        setMonitoring({
                          ...monitoring,
                          reverificationMode: event.target.value as 'AUTOMATIC' | 'INVIGILATOR_APPROVED',
                        })
                      }
                    >
                      <option value="INVIGILATOR_APPROVED">An invigilator must approve (recommended)</option>
                      <option value="AUTOMATIC">Restore automatically on a successful check</option>
                    </Select>
                  </Field>

                  <Field
                    label="Evidence retention (days)"
                    htmlFor="retention"
                    hint="Captures are deleted automatically after this period."
                  >
                    <TextInput
                      id="retention"
                      type="number"
                      min={1}
                      max={3650}
                      value={monitoring.evidenceRetentionDays}
                      onChange={(event) =>
                        setMonitoring({ ...monitoring, evidenceRetentionDays: Number(event.target.value) })
                      }
                    />
                  </Field>
                </div>

                {monitoring.snapshotIntervalSeconds <= 15 ? (
                  <Alert tone="warning" title="Short interval selected">
                    At {monitoring.snapshotIntervalSeconds}-second intervals a 120-minute examination captures roughly{' '}
                    {Math.round((120 * 60) / monitoring.snapshotIntervalSeconds)} images per candidate. For 500
                    candidates that is a significant increase in bandwidth, storage and privacy impact compared with a
                    30-second interval.
                  </Alert>
                ) : null}

                <div className="space-y-4 rounded-card border border-line bg-page px-4 py-4">
                  <Toggle
                    checked={monitoring.facePresenceDetection}
                    onChange={(value) => setMonitoring({ ...monitoring, facePresenceDetection: value })}
                    label="Face-presence detection"
                    description="Confirms a face is in frame."
                  />
                  <Toggle
                    checked={monitoring.identityComparison}
                    onChange={(value) => setMonitoring({ ...monitoring, identityComparison: value })}
                    label="Identity comparison"
                    description="Compares the capture with the enrolment photograph on the candidate record."
                  />
                  <Toggle
                    checked={monitoring.multipleFaceDetection}
                    onChange={(value) => setMonitoring({ ...monitoring, multipleFaceDetection: value })}
                    label="Multiple-face detection"
                    description="Flags a capture containing more than one person."
                  />
                  <Toggle
                    checked={monitoring.humanReviewRequired}
                    onChange={(value) => setMonitoring({ ...monitoring, humanReviewRequired: value })}
                    label="Human review required"
                    description="A person reviews every flagged session. Software never ends an attempt on its own."
                  />
                </div>

                <Field
                  label="Notice shown to candidates"
                  htmlFor="notice"
                  required
                  error={errors['monitoring.candidateNotice']}
                  hint="Shown on the consent screen before the examination begins. Keep it clear and neutral."
                >
                  <TextArea
                    id="notice"
                    rows={4}
                    value={monitoring.candidateNotice}
                    invalid={Boolean(errors['monitoring.candidateNotice'])}
                    onChange={(event) => setMonitoring({ ...monitoring, candidateNotice: event.target.value })}
                  />
                </Field>
              </>
            ) : (
              <Alert tone="info" title="Camera monitoring is switched off">
                No images will be captured or stored for this examination, and no presence warnings will be raised.
              </Alert>
            )}
          </CardBody>
          <WizardFooter step={step} onBack={() => goTo(4)} onNext={() => goTo(6)} />
        </Card>
      ) : null}

      {/* ---------------------------- Step 6 --------------------------- */}
      {step === 6 ? (
        <Card>
          <CardHeader
            icon={<Network aria-hidden className="h-5 w-5" />}
            title="Network and device policy"
            description="Which networks and workstations may connect, and how those machines are configured."
          />
          <CardBody className="space-y-6">
            <InfoPanel title="What IP allowlisting does — and does not do">
              IP allowlisting limits access to approved examination-centre networks. It does not replace encryption or
              candidate verification. Treat it as one layer among several.
            </InfoPanel>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Primary IPv4 range"
                htmlFor="primaryCidr"
                required
                error={errors['network.primaryCidr']}
                hint="CIDR form, for example 10.42.0.0/16."
              >
                <TextInput
                  id="primaryCidr"
                  value={network.primaryCidr}
                  invalid={Boolean(errors['network.primaryCidr'])}
                  onChange={(event) => setNetwork({ ...network, primaryCidr: event.target.value })}
                />
              </Field>

              <Field
                label="Backup IPv4 range"
                htmlFor="backupCidr"
                error={errors['network.backupCidr']}
                hint="Used if the centre fails over to its secondary link."
              >
                <TextInput
                  id="backupCidr"
                  value={network.backupCidr ?? ''}
                  onChange={(event) => setNetwork({ ...network, backupCidr: event.target.value || null })}
                />
              </Field>

              <Field label="IPv6 range" htmlFor="ipv6Cidr" error={errors['network.ipv6Cidr']}>
                <TextInput
                  id="ipv6Cidr"
                  value={network.ipv6Cidr ?? ''}
                  placeholder="2001:db8:42::/48"
                  onChange={(event) => setNetwork({ ...network, ipv6Cidr: event.target.value || null })}
                />
              </Field>

              <Field
                label="Minimum device policy version"
                htmlFor="policyVersion"
                hint="Workstations below this version are refused."
              >
                <TextInput
                  id="policyVersion"
                  value={network.minimumDevicePolicyVersion}
                  onChange={(event) => setNetwork({ ...network, minimumDevicePolicyVersion: event.target.value })}
                />
              </Field>
            </div>

            <div className="space-y-4 rounded-card border border-line bg-page px-4 py-4">
              <Toggle
                checked={network.deviceCertificateRequired}
                onChange={(value) => setNetwork({ ...network, deviceCertificateRequired: value })}
                label="Device certificate required"
                description="A digital identity issued to an approved examination computer. Machines without a valid certificate cannot start an attempt."
              />
              <Toggle
                checked={network.blockGeneralInternet}
                onChange={(value) => setNetwork({ ...network, blockGeneralInternet: value })}
                label="Block general internet access"
                description="Workstations reach only the examination service."
              />
              <Toggle
                checked={network.blockWorkstationToWorkstation}
                onChange={(value) => setNetwork({ ...network, blockWorkstationToWorkstation: value })}
                label="Block workstation-to-workstation traffic"
                description="Prevents machines in the hall from communicating with each other."
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="USB policy" htmlFor="usb" hint="Applies to removable storage at the workstation.">
                <Select
                  id="usb"
                  value={network.usbPolicy}
                  onChange={(event) =>
                    setNetwork({ ...network, usbPolicy: event.target.value as NetworkPolicyInput['usbPolicy'] })
                  }
                >
                  <option value="BLOCKED">Blocked</option>
                  <option value="READ_ONLY">Read only</option>
                  <option value="ALLOWED">Allowed</option>
                </Select>
              </Field>
              <Field label="Bluetooth policy" htmlFor="bluetooth">
                <Select
                  id="bluetooth"
                  value={network.bluetoothPolicy}
                  onChange={(event) =>
                    setNetwork({
                      ...network,
                      bluetoothPolicy: event.target.value as NetworkPolicyInput['bluetoothPolicy'],
                    })
                  }
                >
                  <option value="BLOCKED">Blocked</option>
                  <option value="ALLOWED">Allowed</option>
                </Select>
              </Field>
            </div>

            <Alert tone="info" title="How these settings are enforced">
              The IP allowlist and device-certificate checks are enforced by the examination service on every attempt
              activation. USB, Bluetooth and internet restrictions are applied by the managed operating-system
              configuration on each workstation; this platform records the intended policy and reports compliance.
            </Alert>
          </CardBody>
          <WizardFooter step={step} onBack={() => goTo(5)} onNext={() => goTo(7)} />
        </Card>
      ) : null}

      {/* ---------------------------- Step 7 --------------------------- */}
      {step === 7 ? (
        <div className="space-y-6">
          {submitError ? (
            <Alert tone="critical" title={submitError.message} live>
              {submitError.guidance}
            </Alert>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="space-y-6">
              <Card>
                <CardHeader
                  icon={<ClipboardCheck aria-hidden className="h-5 w-5" />}
                  title="Examination details"
                  actions={
                    <Button size="sm" variant="ghost" onClick={() => setStep(1)}>
                      Edit
                    </Button>
                  }
                />
                <CardBody>
                  <DescriptionList
                    items={[
                      { term: 'Name', value: basics.name || '—' },
                      { term: 'Code', value: basics.code || '—' },
                      { term: 'Subject', value: basics.subject },
                      {
                        term: 'Centre',
                        value: centreList.find((c) => c.id === basics.centreId)?.name ?? 'Not selected',
                      },
                      { term: 'Starts', value: basics.startsAt.replace('T', ' ') },
                      { term: 'Duration', value: `${basics.durationMinutes} minutes` },
                      { term: 'Reporting time', value: basics.reportingTime },
                      { term: 'Navigation', value: NAVIGATION_MODE_LABELS[basics.navigationMode] },
                      { term: 'Results', value: RESULT_MODE_LABELS[basics.resultMode] },
                      { term: 'Time zone', value: basics.timeZone },
                    ]}
                  />
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title="Question blueprint"
                  actions={
                    <Button size="sm" variant="ghost" onClick={() => setStep(2)}>
                      Edit
                    </Button>
                  }
                />
                <CardBody>
                  <DescriptionList
                    items={[
                      { term: 'Questions', value: `${blueprint.totalQuestions}` },
                      { term: 'Marks', value: `${blueprint.totalMarks}` },
                      {
                        term: 'Difficulty',
                        value: `${blueprint.difficultyDistribution.EASY} easy · ${blueprint.difficultyDistribution.MEDIUM} medium · ${blueprint.difficultyDistribution.DIFFICULT} difficult`,
                      },
                      {
                        term: 'Negative marking',
                        value: blueprint.negativeMarking ? 'As specified by each category' : 'Off',
                      },
                      {
                        term: 'Randomisation',
                        value:
                          [
                            blueprint.randomizeQuestionOrder ? 'question order' : null,
                            blueprint.randomizeOptionOrder ? 'option order' : null,
                          ]
                            .filter(Boolean)
                            .join(' and ') || 'None',
                        span: true,
                      },
                    ]}
                  />
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title="Monitoring and network policy"
                  actions={
                    <Button size="sm" variant="ghost" onClick={() => setStep(5)}>
                      Edit
                    </Button>
                  }
                />
                <CardBody>
                  <DescriptionList
                    items={[
                      {
                        term: 'Camera monitoring',
                        value: monitoring.cameraMonitoringEnabled
                          ? `Every ${monitoring.snapshotIntervalSeconds} seconds`
                          : 'Disabled',
                      },
                      {
                        term: 'Warning threshold',
                        value: `${monitoring.consecutiveFailureThreshold} consecutive failures`,
                      },
                      { term: 'Reverification', value: monitoring.reverificationMode.replace('_', ' ').toLowerCase() },
                      { term: 'Evidence retention', value: `${monitoring.evidenceRetentionDays} days` },
                      { term: 'Primary network', value: network.primaryCidr },
                      { term: 'Backup network', value: network.backupCidr ?? 'None configured' },
                      {
                        term: 'Device certificate',
                        value: network.deviceCertificateRequired ? 'Required' : 'Not required',
                      },
                      { term: 'USB / Bluetooth', value: `${network.usbPolicy} / ${network.bluetoothPolicy}` },
                    ]}
                  />
                </CardBody>
              </Card>
            </div>

            <div className="space-y-6">
              <Card as="aside">
                <CardHeader title="Readiness" description="How complete this examination setup is." />
                <CardBody className="space-y-4">
                  <ProgressBar
                    label="Setup complete"
                    value={readiness}
                    tone={readiness === 100 ? 'success' : readiness > 60 ? 'brand' : 'warning'}
                  />
                  <DescriptionList
                    columns={1}
                    items={[
                      { term: 'Candidates assigned', value: 'Add after creation' },
                      { term: 'Security profile', value: profile.name },
                      { term: 'Controls in force', value: `${controls.length}` },
                    ]}
                  />
                </CardBody>
              </Card>

              <Card as="aside">
                <CardHeader
                  title={warnings.length > 0 ? `${warnings.length} unresolved warning${warnings.length === 1 ? '' : 's'}` : 'No unresolved warnings'}
                  description="You can still create the examination — these are advisory."
                />
                <CardBody>
                  {warnings.length === 0 ? (
                    <p className="flex items-center gap-2 text-support text-success">
                      <CheckCircle2 aria-hidden className="h-4 w-4" />
                      Everything needed to create this examination is in place.
                    </p>
                  ) : (
                    <ul className="space-y-2.5">
                      {warnings.map((warning) => (
                        <li key={warning} className="flex gap-2 text-support text-muted">
                          <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                          {warning}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>

              <Card as="aside">
                <CardHeader title={`Security profile — ${profile.name}`} />
                <CardBody>
                  <SecurityControlList controls={controls} compact />
                </CardBody>
                <CardFooter>
                  <Button size="sm" variant="ghost" onClick={() => setStep(4)}>
                    Change profile
                  </Button>
                </CardFooter>
              </Card>
            </div>
          </div>

          <Card>
            <CardBody className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-support font-medium text-ink">Create this examination</p>
                <p className="mt-0.5 text-support text-muted">
                  It will be created as a draft. Questions are assembled, signed and encrypted in a separate, approved
                  step before publication.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => goTo(6)} icon={<ArrowLeft aria-hidden className="h-4 w-4" />}>
                  Back
                </Button>
                <Button
                  variant="primary"
                  size="lg"
                  loading={create.isPending}
                  loadingText="Creating…"
                  onClick={() => {
                    if (validateStep(8)) create.mutate();
                  }}
                >
                  Create examination
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function WizardFooter({
  step,
  onBack,
  onNext,
  backLabel = 'Back',
}: {
  step: number;
  onBack: () => void;
  onNext: () => void;
  backLabel?: string;
}) {
  return (
    <CardFooter className="justify-between">
      <Button variant="secondary" onClick={onBack} icon={<ArrowLeft aria-hidden className="h-4 w-4" />}>
        {backLabel}
      </Button>
      <div className="flex items-center gap-3">
        <span className="text-meta text-muted">Step {step} of 7</span>
        <Button variant="primary" onClick={onNext} iconRight={<ArrowRight aria-hidden className="h-4 w-4" />}>
          Continue
        </Button>
      </div>
    </CardFooter>
  );
}

function defaultStart(): string {
  const date = new Date();
  date.setDate(date.getDate() + 21);
  date.setHours(9, 30, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
