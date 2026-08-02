"use client";

import { useEffect, useRef } from "react";

export function AnimatedTetrahedron() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const chars = "░▒▓█▀▄▌▐│─┤├┴┬╭╮╰╯";

    let palette: string[] = [];
    let lastTheme: string | null = null;

    const rebuildPalette = (isDark: boolean) => {
      const rgb = isDark ? '255,255,255' : '0,0,0';
      palette = [];
      for (let i = 0; i < chars.length; i++) {
        const a = 0.15 + (i / (chars.length - 1)) * 0.75;
        palette.push(`rgba(${rgb},${Math.min(a, 0.9).toFixed(2)})`);
      }
    };
    const initialDark = document.documentElement.classList.contains('dark');
    rebuildPalette(initialDark);
    lastTheme = initialDark ? 'dark' : 'light';

    // Pre-compute tetrahedron vertices and points once
    const baseVertices = [
      { x: 0, y: 1, z: 0 },
      { x: -0.943, y: -0.333, z: -0.5 },
      { x: 0.943, y: -0.333, z: -0.5 },
      { x: 0, y: -0.333, z: 1 },
    ];

    const edges = [[0, 1], [0, 2], [0, 3], [1, 2], [2, 3], [3, 1]];
    const faces = [[0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 3, 2]];

    // Pre-compute base positions (local coords, no rotation)
    const basePositions: { x: number; y: number; z: number }[] = [];

    edges.forEach(([i, j]) => {
      const v1 = baseVertices[i], v2 = baseVertices[j];
      for (let t = 0; t <= 1; t += 0.05) {
        basePositions.push({
          x: v1.x + (v2.x - v1.x) * t,
          y: v1.y + (v2.y - v1.y) * t,
          z: v1.z + (v2.z - v1.z) * t,
        });
      }
    });

    faces.forEach(([i, j, k]) => {
      const v1 = baseVertices[i], v2 = baseVertices[j], v3 = baseVertices[k];
      for (let u = 0; u <= 1; u += 0.12) {
        for (let v = 0; v <= 1 - u; v += 0.12) {
          const w = 1 - u - v;
          basePositions.push({
            x: v1.x * u + v2.x * v + v3.x * w,
            y: v1.y * u + v2.y * v + v3.y * w,
            z: v1.z * u + v2.z * v + v3.z * w,
          });
        }
      }
    });

    let time = 0;
    let animationId = 0;
    const charsLen = chars.length - 1;

    // Cached dimensions — only updated in resize(), NEVER in render()
    let cw = 0, ch = 0, centerX = 0, centerY = 0, scale = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      cw = rect.width;
      ch = rect.height;
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      centerX = cw / 2;
      centerY = ch / 2;
      scale = Math.min(cw, ch) * 0.7;
    };

    resize();
    window.addEventListener("resize", resize);

    const render = () => {
      // No getBoundingClientRect() — use only cached values
      ctx.clearRect(0, 0, cw, ch);

      ctx.font = "18px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const currentTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
      if (currentTheme !== lastTheme) {
        rebuildPalette(currentTheme === 'dark');
        lastTheme = currentTheme;
      }

      const cosY = Math.cos(time * 0.4), sinY = Math.sin(time * 0.4);
      const cosX = Math.cos(time * 0.3), sinX = Math.sin(time * 0.3);
      const cosZ = Math.cos(time * 0.2), sinZ = Math.sin(time * 0.2);

      for (let i = 0; i < basePositions.length; i++) {
        const p = basePositions[i];

        // Rotate Y
        let x = p.x * cosY - p.z * sinY;
        let z = p.x * sinY + p.z * cosY;
        let y = p.y;

        // Rotate X
        const y1 = y * cosX - z * sinX;
        z = y * sinX + z * cosX;
        y = y1;

        // Rotate Z
        const x1 = x * cosZ - y * sinZ;
        y = x * sinZ + y * cosZ;
        x = x1;

        const depth = (z + 1.5) / 3;
        const ci = Math.min(depth * charsLen | 0, charsLen);

        ctx.fillStyle = palette[ci];
        ctx.fillText(chars[ci], centerX + x * scale, centerY - y * scale);
      }

      time += 0.015;
      animationId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ display: "block" }}
    />
  );
}
