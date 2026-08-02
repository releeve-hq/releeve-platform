'use client';
import { useMemo } from 'react';
import { generateContributions, LEVEL_COLORS } from '@/lib/data';

export function ContributionGraph({ seed, size = 'sm' }: { seed: number; size?: string }) {
  const grid = useMemo(() => generateContributions(seed, size === 'sm' ? 14 : 52), [seed, size]);
  const cellSize = size === 'sm' ? 8 : 11;
  const gap = size === 'sm' ? 2 : 3;
  return (
    <div className="flex overflow-hidden" style={{ gap: `${gap}px` }}>
      {grid.map((week, wi) => (
        <div key={wi} className="flex flex-col" style={{ gap: `${gap}px` }}>
          {week.map((level, di) => <div key={di} style={{ width: cellSize, height: cellSize, backgroundColor: LEVEL_COLORS[level], borderRadius: 2 }} />)}
        </div>
      ))}
    </div>
  );
}
