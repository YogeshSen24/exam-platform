import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Users } from 'lucide-react';
import { ROLE_LABELS, type Role, type User } from '@sep/shared';
import { api } from '@/lib/api';
import { formatDateTime, relativeTime } from '@/lib/format';
import { PageHeader } from '@/components/layout/AppShell';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState, SkeletonTable } from '@/components/ui/Feedback';
import { StatusPill } from '@/components/ui/Status';
import { Loadable } from '@/components/ui/QueryState';
import { Avatar, Tabs } from '@/components/ui/Misc';
import { useState } from 'react';
import { InfoPanel } from '@/components/ui/Explain';

type UserRow = User & { centreName: string | null };

interface RolesResponse {
  roles: { id: Role; label: string; description: string; permissions: string[] }[];
}

export function UsersPage() {
  const [tab, setTab] = useState('users');

  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ items: UserRow[]; total: number }>('/users'),
  });

  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<RolesResponse>('/roles'),
  });

  const columns: Column<UserRow>[] = [
    {
      key: 'user',
      header: 'User',
      render: (row) => (
        <div className="flex items-center gap-3">
          <Avatar name={row.fullName} size="sm" />
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium text-ink">
              {row.fullName}
              {row.isDemoAccount ? (
                <StatusPill tone="warning" size="sm">
                  Demo account
                </StatusPill>
              ) : null}
            </p>
            <p className="text-meta text-muted">{row.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'roles',
      header: 'Roles',
      render: (row) => (
        <div className="flex flex-wrap gap-1.5">
          {row.roles.map((role) => (
            <StatusPill key={role} tone="info" size="sm">
              {ROLE_LABELS[role]}
            </StatusPill>
          ))}
        </div>
      ),
    },
    { key: 'centre', header: 'Centre', hideBelow: 'lg', render: (row) => row.centreName ?? 'All centres' },
    {
      key: 'status',
      header: 'Status',
      hideBelow: 'md',
      render: (row) => (
        <StatusPill tone={row.status === 'ACTIVE' ? 'success' : 'critical'} size="sm">
          {row.status === 'ACTIVE' ? 'Active' : 'Suspended'}
        </StatusPill>
      ),
    },
    { key: 'lastLogin', header: 'Last sign-in', hideBelow: 'lg', render: (row) => relativeTime(row.lastLoginAt) },
    { key: 'created', header: 'Created', hideBelow: 'xl', render: (row) => formatDateTime(row.createdAt) },
  ];

  return (
    <div>
      <PageHeader
        title="Users and roles"
        description="Who can do what. Every permission below is enforced by the examination service on each request, not by this interface."
      />

      <Tabs
        className="mb-6"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'users', label: 'Users', count: users.data?.total },
          { id: 'roles', label: 'Roles and permissions', count: roles.data?.roles.length },
        ]}
      />

      {tab === 'users' ? (
        <Card>
          <CardHeader
            icon={<Users aria-hidden className="h-5 w-5" />}
            title={`${users.data?.total ?? 0} users`}
            description="Accounts marked as demonstration accounts must not exist in a production deployment."
          />
          <Loadable
            isLoading={users.isLoading}
            error={users.error}
            onRetry={() => void users.refetch()}
            context="Users"
            skeleton={<SkeletonTable rows={7} columns={5} />}
          >
            <DataTable
              columns={columns}
              rows={users.data?.items ?? []}
              getRowKey={(row) => row.id}
              caption="Platform users"
              emptyState={
                <EmptyState icon={<Users aria-hidden className="h-6 w-6" />} title="No users found" />
              }
            />
          </Loadable>
        </Card>
      ) : null}

      {tab === 'roles' ? (
        <div className="space-y-6">
          <InfoPanel title="Least privilege">
            Each role holds only the permissions its work requires. An invigilator cannot read the question bank or
            publish an examination; a reviewer cannot edit an author's question; nobody can edit an audit event.
          </InfoPanel>

          <Loadable
            isLoading={roles.isLoading}
            error={roles.error}
            onRetry={() => void roles.refetch()}
            context="Roles"
            skeleton={<SkeletonTable rows={7} columns={3} />}
          >
            <div className="grid gap-6 lg:grid-cols-2">
              {(roles.data?.roles ?? []).map((role) => (
                <Card key={role.id}>
                  <CardHeader
                    icon={<ShieldCheck aria-hidden className="h-5 w-5" />}
                    title={role.label}
                    description={role.description}
                  />
                  <CardBody>
                    <p className="text-meta font-medium uppercase tracking-wide text-muted">
                      {role.permissions.length} permissions
                    </p>
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {role.permissions.map((permission) => (
                        <li key={permission}>
                          <code className="rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-meta text-navy">
                            {permission}
                          </code>
                        </li>
                      ))}
                    </ul>
                  </CardBody>
                </Card>
              ))}
            </div>
          </Loadable>
        </div>
      ) : null}
    </div>
  );
}
