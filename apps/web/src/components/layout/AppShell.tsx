import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  BookOpenCheck,
  Building2,
  CalendarClock,
  ClipboardList,
  FileCheck2,
  FileSearch,
  Gauge,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  MonitorSmartphone,
  ScrollText,
  ShieldCheck,
  Siren,
  Users,
  UserSquare2,
  X,
} from 'lucide-react';
import type { Permission } from '@sep/shared';
import { ROLE_LABELS } from '@sep/shared';
import { useSession } from '@/lib/session';
import { classNames } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Misc';
import { DemoDrawer } from '@/components/domain/DemoDrawer';
import { useDemoStore } from '@/lib/demoStore';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  permission: Permission;
  end?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      {
        to: '/admin',
        label: 'Dashboard',
        icon: <LayoutDashboard aria-hidden className="h-4 w-4" />,
        permission: 'exams.read',
        end: true,
      },
    ],
  },
  {
    title: 'Manage',
    items: [
      {
        to: '/admin/exams',
        label: 'Examinations',
        icon: <CalendarClock aria-hidden className="h-4 w-4" />,
        permission: 'exams.read',
      },
      {
        to: '/admin/review',
        label: 'Question review',
        icon: <FileSearch aria-hidden className="h-4 w-4" />,
        permission: 'questions.review',
      },
    ],
  },
  {
    title: 'Infrastructure',
    items: [
      {
        to: '/admin/centres',
        label: 'Centres',
        icon: <Building2 aria-hidden className="h-4 w-4" />,
        permission: 'centres.read',
      },
      {
        to: '/admin/devices',
        label: 'Workstations',
        icon: <MonitorSmartphone aria-hidden className="h-4 w-4" />,
        permission: 'devices.read',
      },
      {
        to: '/admin/users',
        label: 'Users and roles',
        icon: <Users aria-hidden className="h-4 w-4" />,
        permission: 'users.read',
      },
    ],
  },
  {
    title: 'Live operations',
    items: [
      {
        to: '/invigilator',
        label: 'Live examination',
        icon: <ListChecks aria-hidden className="h-4 w-4" />,
        permission: 'invigilation.read',
        end: true,
      },
      {
        to: '/invigilator/alerts',
        label: 'Alert queue',
        icon: <Siren aria-hidden className="h-4 w-4" />,
        permission: 'invigilation.read',
      },
    ],
  },
  {
    title: 'Assurance',
    items: [
      {
        to: '/admin/security',
        label: 'Security profiles',
        icon: <ShieldCheck aria-hidden className="h-4 w-4" />,
        permission: 'exams.read',
      },
      {
        to: '/admin/privacy',
        label: 'Privacy and evidence',
        icon: <ClipboardList aria-hidden className="h-4 w-4" />,
        permission: 'invigilation.read',
      },
      {
        to: '/admin/audit',
        label: 'Audit log',
        icon: <ScrollText aria-hidden className="h-4 w-4" />,
        permission: 'audit.read',
      },
      {
        to: '/admin/health',
        label: 'System health',
        icon: <Gauge aria-hidden className="h-4 w-4" />,
        permission: 'system.health.read',
      },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout, can } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const demo = useDemoStore();

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => can(item.permission)),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="min-h-screen bg-page">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>

      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-line bg-white">
        <div className="flex h-16 items-center gap-4 px-4 sm:px-6">
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden"
            onClick={() => setMobileOpen((value) => !value)}
            aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <Menu aria-hidden className="h-5 w-5" /> : <Menu aria-hidden className="h-5 w-5" />}
          </Button>

          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-navy">
              <ShieldCheck aria-hidden className="h-5 w-5 text-sky" />
            </span>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-support font-semibold text-ink">Examination Board</p>
              <p className="truncate text-meta text-muted">Secure examination platform</p>
            </div>
          </div>

          <span className="ml-1 hidden rounded border border-warning-border bg-warning-soft px-2 py-0.5 text-meta font-medium text-[#9A6410] sm:inline">
            Proof of concept
          </span>

          <div className="ml-auto flex items-center gap-2">
            {demo.enabled ? (
              <Button variant="secondary" size="sm" onClick={() => demo.setOpen(true)} icon={<Activity aria-hidden className="h-4 w-4" />}>
                <span className="hidden sm:inline">Demo mode</span>
                <span className="sm:hidden">Demo</span>
              </Button>
            ) : null}
            <div className="hidden items-center gap-3 border-l border-line pl-3 sm:flex">
              <Avatar name={user?.fullName ?? '—'} size="sm" />
              <div className="leading-tight">
                <p className="text-support font-medium text-ink">{user?.fullName}</p>
                <p className="text-meta text-muted">
                  {user?.roles.map((role) => ROLE_LABELS[role]).join(', ')}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
              icon={<LogOut aria-hidden className="h-4 w-4" />}
            >
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <nav
          aria-label="Main navigation"
          className={classNames(
            'fixed inset-y-16 left-0 z-20 w-68 shrink-0 overflow-y-auto border-r border-line bg-white px-3 py-5 transition-transform lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:translate-x-0',
            mobileOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          {groups.map((group) => (
            <div key={group.title} className="mb-6">
              <p className="px-3 pb-2 text-meta font-semibold uppercase tracking-wide text-muted">{group.title}</p>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={() => setMobileOpen(false)}
                      className={({ isActive }) =>
                        classNames(
                          'flex items-center gap-2.5 rounded-control px-3 py-2 text-support transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                          isActive
                            ? 'bg-brand-50 font-semibold text-brand-700'
                            : 'text-muted hover:bg-panel hover:text-ink',
                        )
                      }
                    >
                      {item.icon}
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="mt-2 rounded-card border border-line bg-panel px-3 py-3">
            <p className="text-meta font-semibold text-ink">Candidate application</p>
            <p className="mt-1 text-meta text-muted">
              The examination workstation experience runs as a separate, full-screen application.
            </p>
            <a
              href="/exam"
              className="mt-2 inline-flex items-center gap-1 text-meta font-medium text-brand hover:underline"
            >
              Open workstation view →
            </a>
          </div>
        </nav>

        {mobileOpen ? (
          <div
            aria-hidden
            className="fixed inset-0 z-10 bg-ink/30 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        ) : null}

        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8" key={location.pathname}>
          <div className="mx-auto max-w-content">{children}</div>
        </main>
      </div>

      <DemoDrawer />
    </div>
  );
}

/** Page title block. Every page has a heading and a one-line description. */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  meta,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
  meta?: ReactNode;
}) {
  useEffect(() => { document.title = `${title} — Secure Examination Platform`; }, [title]);
  return (
    <div className="mb-6">
      {breadcrumb ? <div className="mb-2 text-meta text-muted">{breadcrumb}</div> : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-heading font-semibold tracking-tight text-ink">{title}</h1>
          {description ? <p className="mt-1.5 max-w-prose text-body text-muted">{description}</p> : null}
          {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
