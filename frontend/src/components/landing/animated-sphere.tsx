"use client";

import { useEffect, useRef } from "react";

export function AnimatedSphere() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const chars = "░▒▓█▀▄▌▐│─┤├┴┬╭╮╰╯";

    // Pre-compute fillStyle palette – zero string allocs per frame
    let palette: string[] = [];
    let lastTheme: string | null = null;

    const rebuildPalette = (isDark: boolean) => {
      const rgb = isDark ? '255,255,255' : '0,0,0';
      palette = [];
      for (let i = 0; i < chars.length; i++) {
        const a = 0.2 + (i / (chars.length - 1)) * 0.4;
        palette.push(`rgba(${rgb},${a.toFixed(2)})`);
      }
    };
    // Initialize palette based on current theme
    const initialDark = document.documentElement.classList.contains('dark');
    rebuildPalette(initialDark);
    lastTheme = initialDark ? 'dark' : 'light';

    // Pre-compute sphere base coordinates once (fewer points = fewer fillText calls)
    const basePoints: { x: number; y: number; z: number }[] = [];
    for (let phi = 0; phi < Math.PI * 2; phi += 0.15) {
      for (let theta = 0; theta < Math.PI; theta += 0.15) {
        basePoints.push({
          x: Math.sin(theta) * Math.cos(phi),
          y: Math.sin(theta) * Math.sin(phi),
          z: Math.cos(theta),
        });
      }
    }

    let time = 0;
    let animationId = 0;

    // Cached dimensions — only updated in resize(), NEVER in render()
    let cw = 0, ch = 0, centerX = 0, centerY = 0, radius = 0;

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
      radius = Math.min(cw, ch) * 0.525;
    };

    resize();
    window.addEventListener("resize", resize);

    // Cache trig values across frames to avoid Math.* calls
    let prevTime = -1;
    let cachedCosRY = 0, cachedSinRY = 0, cachedCosRX = 0, cachedSinRX = 0, cachedCosOff = 0, cachedSinOff = 0;

    const render = () => {
      // No getBoundingClientRect() here — use only cached values
      ctx.clearRect(0, 0, cw, ch);

      ctx.font = "12px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Only recompute trig when time changes
      if (time !== prevTime) {
        cachedCosRY = Math.cos(time * 0.3);
        cachedSinRY = Math.sin(time * 0.3);
        cachedCosRX = Math.cos(time * 0.2);
        cachedSinRX = Math.sin(time * 0.2);
        cachedCosOff = Math.cos(time * 0.5);
        cachedSinOff = Math.sin(time * 0.5);
        prevTime = time;
      }

      // Rebuild palette on theme switch
      const currentTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
      if (currentTheme !== lastTheme) {
        rebuildPalette(currentTheme === 'dark');
        lastTheme = currentTheme;
      }

      const cosOff = cachedCosOff, sinOff = cachedSinOff;
      const cosRY = cachedCosRY, sinRY = cachedSinRY;
      const cosRX = cachedCosRX, sinRX = cachedSinRX;
      const len = basePoints.length;
      const charsLen = chars.length - 1;

      for (let i = 0; i < len; i++) {
        const p = basePoints[i];

        const px = p.x * cosOff - p.y * sinOff;
        const py = p.x * sinOff + p.y * cosOff;

        const x1 = px * cosRY - p.z * sinRY;
        const z1 = px * sinRY + p.z * cosRY;

        const y1 = py * cosRX - z1 * sinRX;
        const z2 = py * sinRX + z1 * cosRX;

        const depth = (z2 + 1) * 0.5;
        const ci = depth * charsLen | 0;

        ctx.fillStyle = palette[ci];
        ctx.fillText(chars[ci], centerX + x1 * radius, centerY + y1 * radius);
      }

      time += 0.02;
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
