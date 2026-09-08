import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@sep/shared';
import { useSession } from '@/lib/session';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { PageHeader } from '@/components/layout/AppShell';

export function UnauthorizedPage({ requested }: { requested?: string }) {
  const { user } = useSession();

  return (
    <div>
      <PageHeader
        title="You do not have access to this area"
        description="Permissions are enforced by the examination service, not only by this interface. Your role determines what you can see and do."
      />

      <Card className="max-w-3xl">
        <CardHeader
          icon={<Lock aria-hidden className="h-5 w-5" />}
          title="Access refused"
          description={
            requested
              ? `This page requires the "${requested}" permission, which your role does not include.`
              : 'This page requires a permission your role does not include.'
          }
        />
        <CardBody className="space-y-5">
          {user ? (
            <div className="rounded-card border border-line bg-page px-4 py-3">
              <p className="text-support font-medium text-ink">
                Signed in as {user.fullName} — {user.roles.map((role) => ROLE_LABELS[role]).join(', ')}
              </p>
              <ul className="mt-2 space-y-1.5">
                {user.roles.map((role) => (
                  <li key={role} className="text-support text-muted">
                    {ROLE_DESCRIPTIONS[role]}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <p className="text-support font-medium text-ink">What to do next</p>
            <p className="mt-1 text-support text-muted">
              If you need this access for your work, ask a super administrator to review your role assignment. Role
              changes are recorded in the audit trail.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link to="/admin">
              <Button variant="primary">Return to the dashboard</Button>
            </Link>
            <Link to="/profile">
              <Button variant="secondary">View my roles and permissions</Button>
            </Link>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
