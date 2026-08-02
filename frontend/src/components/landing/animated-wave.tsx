"use client";

import { useEffect, useRef } from "react";

export function AnimatedWave() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const chars = "·∘○◯◌●◉";

    let palette: string[] = [];
    let lastTheme: string | null = null;

    const rebuildPalette = (isDark: boolean) => {
      const rgb = isDark ? '255,255,255' : '0,0,0';
      palette = [];
      for (let i = 0; i < chars.length; i++) {
        const a = 0.15 + (i / (chars.length - 1)) * 0.5;
        palette.push(`rgba(${rgb},${a.toFixed(2)})`);
      }
    };
    const initialDark = document.documentElement.classList.contains('dark');
    rebuildPalette(initialDark);
    lastTheme = initialDark ? 'dark' : 'light';

    let time = 0;
    let animationId = 0;
    const charsLen = chars.length - 1;

    // Cached dimensions — only updated in resize(), NEVER in render()
    let cw = 0, ch = 0, cols = 0, rows = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      cw = rect.width;
      ch = rect.height;
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.floor(cw / 20);
      rows = Math.floor(ch / 20);
    };

    resize();
    window.addEventListener("resize", resize);

    const render = () => {
      // No getBoundingClientRect() — use only cached values
      ctx.clearRect(0, 0, cw, ch);

      ctx.font = "14px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const currentTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
      if (currentTheme !== lastTheme) {
        rebuildPalette(currentTheme === 'dark');
        lastTheme = currentTheme;
      }

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const px = (x + 0.5) * (cw / cols);
          const py = (y + 0.5) * (ch / rows);

          const wave1 = Math.sin(x * 0.2 + time * 2) * Math.cos(y * 0.15 + time);
          const wave2 = Math.sin((x + y) * 0.1 + time * 1.5);
          const wave3 = Math.cos(x * 0.1 - y * 0.1 + time * 0.8);
          
          const combined = (wave1 + wave2 + wave3) / 3;
          const normalized = (combined + 1) / 2;
          
          const ci = normalized * charsLen | 0;

          ctx.fillStyle = palette[ci];
          ctx.fillText(chars[ci], px, py);
        }
      }

      time += 0.03;
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
