import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Check, KeyRound, ShieldAlert } from 'lucide-react';
import type { ActivationKeyRecord, CategoryQuota, SecurityProfileId } from '@sep/shared';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/AppShell';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextInput, TextArea, Toggle } from '@/components/ui/Form';
import { Alert, EmptyState, SkeletonCards } from '@/components/ui/Feedback';
import { StatusPill } from '@/components/ui/Status';
import { Loadable } from '@/components/ui/QueryState';
import { InfoPanel } from '@/components/ui/Explain';
import { DataTable } from '@/components/ui/DataTable';
import { useSession } from '@/lib/session';
import { useToast } from '@/components/ui/Misc';

/**
 * Issuing centre keys.
 *
 * This is where an examination stops being a plan and becomes a set of
 * machines in rooms. Everything a centre will do is decided here, because a
 * centre has no other source of rules: the key is the configuration.
 *
 * The key is shown exactly once. It is never stored, so it cannot be fetched
 * back and cannot leak from the database later.
 */

interface ContextExam {
  id: string;
  code: string;
  name: string;
  startsAt: string;
  durationMinutes: number;
  securityProfileId: SecurityProfileId;
  issuable: boolean;
  blockedReason: string | null;
  paper: {
    manifestId: string;
    poolSize: number;
    deliveredQuestionCount: number;
    deliveredTotalMarks: number;
    quotas: CategoryQuota[];
  } | null;
}

interface ContextCentre {
  id: string;
  code: string;
  name: string;
  city: string;
  primaryCidr: string;
  capacity: number;
}

interface IssueContext {
  deployment: { id: string; keyId: string };
  exams: ContextExam[];
  centres: ContextCentre[];
}

interface RuleLine {
  label: string;
  value: string;
  emphasis?: boolean;
}

interface IssuedKey {
  key: string;
  displayForm: string;
  record: ActivationKeyRecord;
  summary: string;
  rules: RuleLine[];
  warnings: string[];
}

export function CentreKeysPage() {
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();

  const context = useQuery({
    queryKey: ['activation-context'],
    queryFn: () => api.get<IssueContext>('/activation/context'),
  });

  const keys = useQuery({
    queryKey: ['activation-keys'],
    queryFn: () => api.get<{ keys: ActivationKeyRecord[] }>('/activation/keys'),
  });

  const [examId, setExamId] = useState('');
  const [centreId, setCentreId] = useState('');
  const [validForDays, setValidForDays] = useState(30);
  const [maxStations, setMaxStations] = useState(50);
  const [room, setRoom] = useState('');
  const [session, setSession] = useState('');
  const [note, setNote] = useState('');
  const [requireFingerprint, setRequireFingerprint] = useState(false);
  const [faceAtLogin, setFaceAtLogin] = useState(false);
  const [cameraMonitoring, setCameraMonitoring] = useState(false);
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const [copied, setCopied] = useState(false);

  const exams = context.data?.exams ?? [];
  const centres = context.data?.centres ?? [];
  const selectedExam = useMemo(() => exams.find((e) => e.id === examId), [exams, examId]);

  const issue = useMutation({
    mutationFn: () =>
      api.post<IssuedKey>('/activation/keys', {
        examId,
        centreId,
        validForDays,
        maxStations,
        room: room.trim(),
        session: session.trim(),
        tags: {},
        note,
        overrides: {
          fingerprint: requireFingerprint ? 'REQUIRED' : undefined,
          faceAtLogin: faceAtLogin || undefined,
          cameraMonitoring: cameraMonitoring || undefined,
        },
      }),
    onSuccess: (result) => {
      setIssued(result);
      setCopied(false);
      void queryClient.invalidateQueries({ queryKey: ['activation-keys'] });
    },
  });

  const revoke = useMutation({
    mutationFn: ({ keyId, reason }: { keyId: string; reason: string }) =>
      api.post(`/activation/keys/${keyId}/revoke`, { reason }),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'Key revoked', description: 'Machines set up with it can no longer be used.' });
      void queryClient.invalidateQueries({ queryKey: ['activation-keys'] });
    },
  });

  const canIssue = examId !== '' && centreId !== '' && (selectedExam?.issuable ?? false);

  async function copyKey() {
    if (!issued) return;
    await navigator.clipboard.writeText(issued.key);
    setCopied(true);
    toast.push({ tone: 'success', title: 'Key copied', description: 'Send it to the centre moderator.' });
  }

  return (
    <div>
      <PageHeader
        title="Centre keys"
        description="A key tells a machine which examination it is running. It carries the rules and the metadata, never the questions."
      />

      <InfoPanel title="What a key does, and what it deliberately does not do" className="mb-6">
        A board runs several examinations at once, so a machine has to be told which one it is running. A key does
        that, and carries the rules with it: which identity checks a candidate must pass, how many questions they draw,
        and which room and sitting to record against their results. It carries no question content, so a key that is
        intercepted gives nobody a way to read a single question.
      </InfoPanel>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Card>
            <CardHeader
              icon={<KeyRound aria-hidden className="h-5 w-5" />}
              title="Issue a key"
              description="The key appears once, here. It is never stored and cannot be retrieved later."
            />
            <CardBody className="space-y-5">
              <Loadable
                isLoading={context.isLoading}
                error={context.error}
                onRetry={() => void context.refetch()}
                context="Key issuing"
                skeleton={<SkeletonCards count={1} />}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Examination" htmlFor="exam">
                    <Select id="exam" value={examId} onChange={(e) => setExamId(e.target.value)}>
                      <option value="">Choose an examination</option>
                      {exams.map((exam) => (
                        <option key={exam.id} value={exam.id} disabled={!exam.issuable}>
                          {exam.name} ({exam.code}){exam.issuable ? '' : ' \u2014 paper not published'}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="Centre" htmlFor="centre">
                    <Select id="centre" value={centreId} onChange={(e) => setCentreId(e.target.value)}>
                      <option value="">Choose a centre</option>
                      {centres.map((centre) => (
                        <option key={centre.id} value={centre.id}>
                          {centre.name} ({centre.code}) \u2014 seats {centre.capacity}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field
                    label="Room or hall"
                    htmlFor="room"
                    hint="Recorded on every result from a machine set up with this key."
                  >
                    <TextInput id="room" value={room} placeholder="Room 4" onChange={(e) => setRoom(e.target.value)} />
                  </Field>

                  <Field label="Sitting" htmlFor="session" hint="Morning, afternoon, or a named sitting.">
                    <TextInput
                      id="session"
                      value={session}
                      placeholder="Morning"
                      onChange={(e) => setSession(e.target.value)}
                    />
                  </Field>

                  <Field label="Key valid for" htmlFor="validity" hint="After this it stops working, used or not.">
                    <Select id="validity" value={validForDays} onChange={(e) => setValidForDays(Number(e.target.value))}>
                      <option value={7}>7 days</option>
                      <option value={14}>14 days</option>
                      <option value={30}>30 days</option>
                      <option value={90}>90 days</option>
                    </Select>
                  </Field>

                  <Field
                    label="Machines this key may set up"
                    htmlFor="max"
                    hint="A limit is what stops one key quietly provisioning a second room."
                  >
                    <TextInput
                      id="max"
                      type="number"
                      min={1}
                      max={2000}
                      value={maxStations}
                      onChange={(e) => setMaxStations(Number(e.target.value))}
                    />
                  </Field>
                </div>

                <fieldset className="space-y-3 rounded-card border border-line px-4 py-3.5">
                  <legend className="px-1 text-support font-medium text-ink">Checks this centre must apply</legend>
                  <p className="text-support text-ink-muted">
                    These start from the examination&rsquo;s own security profile. Change one only where a centre
                    genuinely differs, because every candidate at this centre will meet it.
                  </p>
                  <Toggle
                    label="Require a fingerprint scan"
                    description="Candidates cannot start without one. The centre needs readers on every machine."
                    checked={requireFingerprint}
                    onChange={setRequireFingerprint}
                  />
                  <Toggle
                    label="Require a face check at sign-in"
                    description="Compared against the enrolment photograph on the candidate record."
                    checked={faceAtLogin}
                    onChange={setFaceAtLogin}
                  />
                  <Toggle
                    label="Keep the camera on during the examination"
                    description="Raises an invigilator alert when nobody, or more than one person, is present."
                    checked={cameraMonitoring}
                    onChange={setCameraMonitoring}
                  />
                </fieldset>

                <Field label="Note for the centre" htmlFor="note" hint="Shown to the moderator after a successful setup.">
                  <TextArea
                    id="note"
                    rows={2}
                    value={note}
                    placeholder="Room 4, morning session."
                    onChange={(e) => setNote(e.target.value)}
                  />
                </Field>

                {selectedExam && !selectedExam.issuable && (
                  <Alert tone="warning" title="This examination cannot be sent to a centre yet">
                    {selectedExam.blockedReason} A centre configured for a paper that does not exist would fail on the
                    morning, so the key is refused here instead.
                  </Alert>
                )}

                {issue.error && (
                  <Alert tone="critical" title="The key could not be issued">
                    {(issue.error as Error).message}
                  </Alert>
                )}

                <Button
                  variant="primary"
                  disabled={!canIssue || issue.isPending || !can('centres.provision')}
                  onClick={() => issue.mutate()}
                >
                  {issue.isPending ? 'Issuing…' : 'Issue this key'}
                </Button>
              </Loadable>
            </CardBody>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-6">
          {selectedExam?.paper && (
            <Card>
              <CardHeader
                title="What each candidate will sit"
                description="Drawn from the sealed pool, so no two candidates get the same paper."
              />
              <CardBody className="space-y-3">
                <p className="text-body text-ink">
                  <strong>{selectedExam.paper.deliveredQuestionCount} questions</strong> worth{' '}
                  {selectedExam.paper.deliveredTotalMarks} marks, drawn from a sealed pool of{' '}
                  <strong>{selectedExam.paper.poolSize}</strong>.
                </p>
                <ul className="space-y-1 text-support text-ink-muted">
                  {selectedExam.paper.quotas.map((quota) => (
                    <li key={quota.categoryId} className="flex justify-between gap-3">
                      <span>{quota.categoryName}</span>
                      <span className="tabular-nums">
                        {quota.deliver} of {quota.poolSize}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          {issued && (
            <Card>
              <CardHeader
                icon={<ShieldAlert aria-hidden className="h-5 w-5" />}
                title="Copy this key now"
                description="It is shown once and is not stored anywhere. Closing this page loses it."
              />
              <CardBody className="space-y-4">
                <p className="text-body text-ink">{issued.summary}</p>

                <div className="rounded-card border border-line bg-surface-sunken p-3">
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-ink">
                    {issued.displayForm}
                  </pre>
                </div>

                <Button variant="primary" onClick={() => void copyKey()}>
                  {copied ? (
                    <>
                      <Check aria-hidden className="mr-2 h-4 w-4" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy aria-hidden className="mr-2 h-4 w-4" /> Copy the key
                    </>
                  )}
                </Button>

                {issued.warnings.map((warning) => (
                  <Alert key={warning} tone="warning" title={warning} />
                ))}

                <dl className="divide-y divide-line text-support">
                  {issued.rules.map((rule) => (
                    <div key={rule.label} className="grid grid-cols-[minmax(0,9rem)_1fr] gap-3 py-2">
                      <dt className="text-ink-muted">{rule.label}</dt>
                      <dd className={rule.emphasis ? 'font-medium text-ink' : 'text-ink'}>{rule.value}</dd>
                    </div>
                  ))}
                </dl>
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Keys issued"
          description="Every key that has left this building, and what became of it. Fingerprints only \u2014 no key is stored."
        />
        <CardBody>
          <Loadable
            isLoading={keys.isLoading}
            error={keys.error}
            onRetry={() => void keys.refetch()}
            context="Issued keys"
            skeleton={<SkeletonCards count={2} />}
          >
            {keys.data && keys.data.keys.length > 0 ? (
              <DataTable<ActivationKeyRecord>
                rows={keys.data.keys}
                getRowKey={(row) => row.id}
                caption="Activation keys issued to examination centres"
                columns={[
                  { key: 'exam', header: 'Examination', render: (row) => `${row.examName} (${row.examCode})` },
                  { key: 'centre', header: 'Centre', render: (row) => `${row.centreName} (${row.centreCode})` },
                  {
                    key: 'where',
                    header: 'Room and sitting',
                    render: (row) => [row.room, row.session].filter(Boolean).join(' \u00b7 ') || '\u2014',
                  },
                  {
                    key: 'used',
                    header: 'Machines set up',
                    render: (row) => `${row.activationCount} of ${row.maxStations}`,
                  },
                  {
                    key: 'status',
                    header: 'Status',
                    render: (row) => (
                      <StatusPill
                        size="sm"
                        tone={
                          row.status === 'REVOKED'
                            ? 'critical'
                            : row.status === 'EXPIRED'
                              ? 'neutral'
                              : row.status === 'ACTIVATED'
                                ? 'success'
                                : 'info'
                        }
                      >
                        {row.status === 'ISSUED'
                          ? 'Issued, not yet used'
                          : row.status === 'ACTIVATED'
                            ? 'In use'
                            : row.status === 'EXPIRED'
                              ? 'Expired'
                              : 'Revoked'}
                      </StatusPill>
                    ),
                  },
                  {
                    key: 'actions',
                    header: '',
                    render: (row) =>
                      row.status !== 'REVOKED' && can('centres.provision') ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const reason = window.prompt(
                              'Why is this key being revoked? Machines already set up with it will stop working.',
                            );
                            if (reason && reason.trim().length >= 4) {
                              revoke.mutate({ keyId: row.id, reason: reason.trim() });
                            }
                          }}
                        >
                          Revoke
                        </Button>
                      ) : null,
                  },
                ]}
              />
            ) : (
              <EmptyState
                title="No keys issued yet"
                description="Issue a key for a room, then paste it into each machine in that room."
              />
            )}
          </Loadable>
        </CardBody>
      </Card>
    </div>
  );
}
