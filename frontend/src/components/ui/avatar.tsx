'use client';
import { cx } from '@/lib/data';

export function Avatar({ name, color = 'bg-violet-600', size = 9 }: { name: string; color?: string; size?: number }) {
  const initials = (name || '?').split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
  const sizeClass = { 7: 'w-7 h-7 text-[11px]', 8: 'w-8 h-8 text-xs', 9: 'w-9 h-9 text-xs', 10: 'w-10 h-10 text-sm', 12: 'w-12 h-12 text-sm', 16: 'w-16 h-16 text-lg' }[size] || 'w-9 h-9 text-xs';
  return <div className={cx(sizeClass, color, 'rounded-full flex items-center justify-center text-white font-semibold shrink-0')}>{initials}</div>;
}
