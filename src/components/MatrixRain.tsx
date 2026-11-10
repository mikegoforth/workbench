"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

// Half-width katakana, digits and a few symbols: the falling-code look.
const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789:.=*+-<>";
const CELL = 18; // px per glyph, both ways
const FRAME_MS = 66; // ~15 fps: enough to read as motion, light on the CPU
const TRAIL = "rgba(2, 10, 4, 0.14)"; // Matrix --bg; each frame fades the old glyphs a little

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
const isMatrix = () => document.documentElement.dataset.theme === "matrix";

/**
 * Falling green glyphs behind the app, only while the Matrix theme is on
 * (including its live preview in the theme picker). It shows in the page's
 * background gaps; cards and text stay solid. Pauses while the window is
 * hidden, and draws one still frame when the system asks for reduced motion.
 */
export default function MatrixRain() {
  const active = useSyncExternalStore(subscribe, isMatrix, () => false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!active || !canvas || !ctx) return;

    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const family = getComputedStyle(document.body).fontFamily || "monospace";
    let drops: { y: number; speed: number }[] = [];
    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${CELL - 4}px ${family}`;
      ctx.textBaseline = "top";
      const rows = Math.ceil(height / CELL);
      drops = Array.from({ length: Math.ceil(width / CELL) }, () => ({ y: -Math.random() * rows, speed: 0.35 + Math.random() * 0.65 }));
    };

    const step = () => {
      ctx.fillStyle = TRAIL;
      ctx.fillRect(0, 0, width, height);
      for (let i = 0; i < drops.length; i++) {
        const drop = drops[i];
        const glyph = GLYPHS[(Math.random() * GLYPHS.length) | 0];
        const x = i * CELL;
        const y = Math.floor(drop.y) * CELL;
        // The leading glyph is pale and bright; the trail it leaves is green.
        ctx.fillStyle = Math.random() < 0.08 ? "#e6ffec" : "#00ff41";
        ctx.fillText(glyph, x, y);
        drop.y += drop.speed;
        if (y > height && Math.random() > 0.97) drop.y = -Math.random() * 8;
      }
    };

    resize();
    window.addEventListener("resize", resize);

    if (reduceMotion) {
      // A still field of glyphs: the look, without the motion.
      for (let i = 0; i < 90; i++) step();
      return () => window.removeEventListener("resize", resize);
    }

    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden || now - last < FRAME_MS) return;
      last = now;
      step();
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [active]);

  if (!active) return null;
  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none fixed inset-0 -z-10 h-full w-full opacity-50" />;
}
