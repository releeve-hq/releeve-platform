'use client';
import { cx } from '@/lib/data';

export function DifficultyBadge({ level }: { level: string }) {
  const map: Record<string, string> = { Easy: 'bg-emerald-50 text-emerald-700 border-emerald-200', Medium: 'bg-amber-50 text-amber-700 border-amber-200', Hard: 'bg-rose-50 text-rose-700 border-rose-200' };
  return <span className={cx('px-2 py-0.5 rounded-md text-xs font-medium border', map[level])}>{level}</span>;
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    open: { cls: 'bg-blue-50 text-blue-700 border-blue-200', label: 'Open' },
    'in-progress': { cls: 'bg-amber-50 text-amber-700 border-amber-200', label: 'In progress' },
    completed: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Completed' },
    rejected: { cls: 'bg-rose-50 text-rose-700 border-rose-200', label: 'Rejected' },
  };
  const s = map[status] || map.open;
  return <span className={cx('px-2 py-0.5 rounded-md text-xs font-medium border', s.cls)}>{s.label}</span>;
}

export function Tag({ children }: { children: React.ReactNode }) {
  return <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-gray-100 text-gray-600 border border-gray-200">{children}</span>;
}
