import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { classNames } from '@/lib/format';
import { Button } from './Button';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
  headerClassName?: string;
  /** Hidden below the given breakpoint so tables stay readable on small screens. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
}

const HIDE_CLASS = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
} as const;

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  caption,
  emptyState,
  dense,
}: {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  caption?: string;
  emptyState?: ReactNode;
  dense?: boolean;
}) {
  if (rows.length === 0 && emptyState) return <>{emptyState}</>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-left">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-line bg-page">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={classNames(
                  'whitespace-nowrap px-4 py-3 text-meta font-semibold uppercase tracking-wide text-muted',
                  column.hideBelow && HIDE_CLASS[column.hideBelow],
                  column.headerClassName,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={getRowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
              tabIndex={onRowClick ? 0 : undefined}
              className={classNames(
                'border-b border-line last:border-0',
                onRowClick &&
                  'cursor-pointer transition-colors hover:bg-page focus:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand',
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={classNames(
                    'px-4 align-middle text-support text-ink',
                    dense ? 'py-2.5' : 'py-3.5',
                    column.hideBelow && HIDE_CLASS[column.hideBelow],
                    column.className,
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  label = 'items',
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  label?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-3">
      <p className="tnum text-meta text-muted">
        Showing {from}–{to} of {total} {label}
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          icon={<ChevronLeft aria-hidden className="h-4 w-4" />}
        >
          Previous
        </Button>
        <span className="tnum text-meta text-muted">
          Page {page} of {pages}
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
          iconRight={<ChevronRight aria-hidden className="h-4 w-4" />}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
