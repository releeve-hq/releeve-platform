'use client';
import { BRAND } from '@/lib/data';

export function EmptyState({ icon: Icon, title, message }: { icon: React.ComponentType<{ size?: number; className?: string }>; title: string; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="relative mb-4">
        <div className="absolute inset-0 flex items-center justify-center opacity-[0.06]">
          <div className="grid grid-cols-6 gap-1">{Array.from({ length: 24 }).map((_, i) => <div key={i} className="w-2 h-2 rounded-[2px]" style={{ backgroundColor: BRAND.violet }} />)}</div>
        </div>
        <div className="relative w-14 h-14 rounded-2xl bg-violet-50 border border-violet-100 flex items-center justify-center"><Icon size={22} className="text-violet-500" /></div>
      </div>
      <div className="text-[15px] font-semibold text-gray-900 mb-1">{title}</div>
      <div className="text-sm text-gray-500 max-w-sm">{message}</div>
    </div>
  );
}
