import { ExamWorkspace } from '@/components/layout/ExamWorkspace';
import { ImportPage } from '@/pages/admin/ImportPage';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Permission } from '@sep/shared';
import { useSession } from '@/lib/session';
import { AppShell } from '@/components/layout/AppShell';
import { LoadingScreen } from '@/components/layout/LoadingScreen';

import { LoginPage } from '@/pages/shared/LoginPage';
import { UnauthorizedPage } from '@/pages/shared/UnauthorizedPage';
import { NotFoundPage } from '@/pages/shared/NotFoundPage';
import { ProfilePage } from '@/pages/shared/ProfilePage';
import { NotificationsPage } from '@/pages/shared/NotificationsPage';

import { AdminDashboard } from '@/pages/admin/AdminDashboard';
import { ExamListPage } from '@/pages/admin/ExamListPage';
import { ExamWizardPage } from '@/pages/admin/ExamWizardPage';
import { ExamDetailPage } from '@/pages/admin/ExamDetailPage';
import { QuestionBankPage } from '@/pages/admin/QuestionBankPage';
import { QuestionEditorPage } from '@/pages/admin/QuestionEditorPage';
import { QuestionReviewPage } from '@/pages/admin/QuestionReviewPage';
import { PaperBuilderPage } from '@/pages/admin/PaperBuilderPage';
import { PaperIntegrityPage } from '@/pages/admin/PaperIntegrityPage';
import { CandidateListPage } from '@/pages/admin/CandidateListPage';
import { CandidateDetailPage } from '@/pages/admin/CandidateDetailPage';
import { CentrePage } from '@/pages/admin/CentrePage';
import { DevicePage } from '@/pages/admin/DevicePage';
import { DeviceReadinessPage } from '@/pages/admin/DeviceReadinessPage';
import { SecurityProfilePage } from '@/pages/admin/SecurityProfilePage';
import { UsersPage } from '@/pages/admin/UsersPage';
import { AuditLogPage } from '@/pages/admin/AuditLogPage';
import { SystemHealthPage } from '@/pages/admin/SystemHealthPage';
import { PrivacyPage } from '@/pages/admin/PrivacyPage';

import { InvigilatorDashboard } from '@/pages/invigilator/InvigilatorDashboard';
import { SessionDetailPage } from '@/pages/invigilator/SessionDetailPage';
import { AlertQueuePage } from '@/pages/invigilator/AlertQueuePage';
import { IncidentDetailPage } from '@/pages/invigilator/IncidentDetailPage';

import { CandidateApp } from '@/pages/candidate/CandidateApp';

/** Wraps a staff route: requires a session and, optionally, a permission. */
function Protected({ permission, children }: { permission?: Permission; children: JSX.Element }) {
  const { status, user, can } = useSession();
  const location = useLocation();

  if (status === 'loading') return <LoadingScreen label="Checking your session" />;
  if (status === 'anonymous' || !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (user.kind === 'CANDIDATE') return <Navigate to="/exam" replace />;
  if (permission && !can(permission)) return <UnauthorizedPage requested={permission} />;

  return <AppShell>{children}</AppShell>;
}

export function App() {
  return (
    <Routes>
      {/* Candidate workstation application — deliberately a separate shell. */}
      <Route path="/exam/*" element={<CandidateApp />} />

      <Route path="/login" element={<LoginPage />} />
      <Route path="/unauthorized" element={<UnauthorizedPage />} />

      <Route path="/" element={<Navigate to="/admin" replace />} />

      <Route path="/profile" element={<Protected><ProfilePage /></Protected>} />
      <Route path="/notifications" element={<Protected><NotificationsPage /></Protected>} />

      <Route path="/admin" element={<Protected permission="exams.read"><AdminDashboard /></Protected>} />
      <Route path="/admin/exams" element={<Protected permission="exams.read"><ExamListPage /></Protected>} />
      <Route path="/admin/exams/:examId/candidates" element={<Protected permission="candidates.read"><ExamWorkspace><CandidateListPage /></ExamWorkspace></Protected>} />
      <Route path="/admin/exams/:examId/candidates/:candidateId" element={<Protected permission="candidates.read"><ExamWorkspace><CandidateDetailPage /></ExamWorkspace></Protected>} />
      <Route path="/admin/exams/:examId/questions" element={<Protected permission="questions.read"><ExamWorkspace><QuestionBankPage /></ExamWorkspace></Protected>} />
      <Route path="/admin/exams/:examId/questions/new" element={<Protected permission="questions.write"><ExamWorkspace><QuestionEditorPage /></ExamWorkspace></Protected>} />
      <Route path="/admin/exams/:examId/questions/:questionId" element={<Protected permission="questions.read"><ExamWorkspace><QuestionEditorPage /></ExamWorkspace></Protected>} />
      <Route path="/admin/exams/:examId/paper" element={<Protected permission="questions.read"><ExamWorkspace><PaperBuilderPage /></ExamWorkspace></Protected>} />
      <Route path="/admin/exams/:examId/import" element={<Protected permission="candidates.write"><ExamWorkspace><ImportPage /></ExamWorkspace></Protected>} />
      <Route path="/admin/exams/new" element={<Protected permission="exams.write"><ExamWizardPage /></Protected>} />
      <Route path="/admin/exams/:examId" element={<Protected permission="exams.read"><ExamWorkspace><ExamDetailPage /></ExamWorkspace></Protected>} />
      <Route
        path="/admin/exams/:examId/integrity"
        element={<Protected permission="exams.read"><ExamWorkspace><PaperIntegrityPage /></ExamWorkspace></Protected>}
      />
      <Route path="/admin/questions" element={<Navigate to="/admin/exams" replace />} />
      <Route path="/admin/questions/new" element={<Navigate to="/admin/exams" replace />} />
      <Route
        path="/admin/questions/:questionId"
        element={<Protected permission="questions.read"><QuestionEditorPage /></Protected>}
      />
      <Route path="/admin/review" element={<Protected permission="questions.review"><QuestionReviewPage /></Protected>} />
      <Route path="/admin/paper" element={<Navigate to="/admin/exams" replace />} />
      <Route path="/admin/import" element={<Navigate to="/admin/exams" replace />} />
      <Route path="/admin/candidates" element={<Navigate to="/admin/exams" replace />} />
      <Route
        path="/admin/candidates/:candidateId"
        element={<Protected permission="candidates.read"><CandidateDetailPage /></Protected>}
      />
      <Route path="/admin/centres" element={<Protected permission="centres.read"><CentrePage /></Protected>} />
      <Route path="/admin/devices" element={<Protected permission="devices.read"><DevicePage /></Protected>} />
      <Route
        path="/admin/devices/:deviceId"
        element={<Protected permission="devices.read"><DeviceReadinessPage /></Protected>}
      />
      <Route path="/admin/security" element={<Protected permission="exams.read"><SecurityProfilePage /></Protected>} />
      <Route path="/admin/privacy" element={<Protected permission="invigilation.read"><PrivacyPage /></Protected>} />
      <Route path="/admin/users" element={<Protected permission="users.read"><UsersPage /></Protected>} />
      <Route path="/admin/audit" element={<Protected permission="audit.read"><AuditLogPage /></Protected>} />
      <Route path="/admin/health" element={<Protected permission="system.health.read"><SystemHealthPage /></Protected>} />

      <Route path="/invigilator" element={<Protected permission="invigilation.read"><InvigilatorDashboard /></Protected>} />
      <Route
        path="/invigilator/sessions/:attemptId"
        element={<Protected permission="invigilation.read"><SessionDetailPage /></Protected>}
      />
      <Route path="/invigilator/alerts" element={<Protected permission="invigilation.read"><AlertQueuePage /></Protected>} />
      <Route
        path="/invigilator/incidents/:incidentId"
        element={<Protected permission="invigilation.read"><IncidentDetailPage /></Protected>}
      />

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
