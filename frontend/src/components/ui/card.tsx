'use client';
import { cx } from '@/lib/data';

export function Card({ children, className = '', onClick = undefined, hoverable = false }: { children?: React.ReactNode; className?: string; onClick?: ((e: React.MouseEvent<HTMLDivElement>) => void) | undefined; hoverable?: boolean }) {
  return (
    <div onClick={onClick} className={cx('bg-[#111113] border border-white/[0.07] rounded-2xl', hoverable && 'transition-all duration-150 hover:shadow-md hover:border-white/15 cursor-pointer', className)} style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
      {children}
    </div>
  );
}
