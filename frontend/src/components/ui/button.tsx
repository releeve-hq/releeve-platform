'use client';
import { cx, BRAND } from '@/lib/data';

export function PrimaryButton({
  children,
  onClick,
  className = '',
  icon: Icon,
  type = 'button',
  disabled = false
}: {
  children?: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  icon?: any;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={cx('inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white transition-all duration-150', disabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90 active:scale-[0.98]', className)}
      style={{ backgroundColor: BRAND.violet }}>
      {Icon && <Icon size={15} />}{children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  className = '',
  icon: Icon,
  disabled = false
}: {
  children?: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  icon?: any;
  disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} className={cx('inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all duration-150', disabled ? 'opacity-50 cursor-not-allowed text-zinc-500 bg-white/5 border-white/10' : 'text-zinc-200 bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 active:scale-[0.98]', className)}>
      {Icon && <Icon size={15} />}{children}
    </button>
  );
}

export function IconButton({
  icon: Icon,
  onClick,
  active,
  className = ''
}: {
  icon: any;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  className?: string;
}) {
  return (
    <button onClick={onClick} className={cx('w-9 h-9 rounded-xl flex items-center justify-center transition-colors duration-150 border', active ? 'bg-violet-600/20 border-violet-500/30 text-violet-400' : 'bg-white/5 border-white/10 text-zinc-400 hover:bg-white/10 hover:text-zinc-200', className)}>
      <Icon size={16} />
    </button>
  );
}

