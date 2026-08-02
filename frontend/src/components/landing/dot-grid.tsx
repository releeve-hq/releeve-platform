"use client";

export function DotGrid() {
  const staticDots: [number, number][] = [];
  for (let x = 36; x < 1600; x += 18) {
    for (let y = 36; y < 900; y += 18) {
      staticDots.push([x, y]);
    }
  }

  const glowDots: [number, number, string][] = [
    [1404, 36, "1.1s"], [1422, 36, "0.44s"], [1440, 36, "1.32s"],
    [1458, 36, "0.66s"], [1476, 36, "0s"], [1494, 36, "0.88s"],
    [72, 522, "1.32s"], [90, 522, "0.66s"],
    [108, 522, "0s"], [126, 522, "0.88s"],
  ];

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
        <g fill="rgba(255,255,255,0.08)">
          {staticDots.map(([cx, cy], i) => (
            <circle key={`s-${i}`} cx={cx} cy={cy} r={1.5} />
          ))}
        </g>
        <g fill="rgba(167,139,250,0.3)">
          {glowDots.map(([cx, cy, begin], i) => (
            <circle key={`g-${i}`} cx={cx} cy={cy} r={1.7}>
              <animate attributeName="r" values="1.7;2.4;1.7" dur="1.8s" begin={begin} repeatCount="indefinite" />
              <animate attributeName="fill-opacity" values="0.3;0.7;0.3" dur="1.8s" begin={begin} repeatCount="indefinite" />
            </circle>
          ))}
        </g>
      </svg>
    </div>
  );
}