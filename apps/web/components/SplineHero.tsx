"use client";

import { useEffect, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Node {
  x: number; y: number;
  vx: number; vy: number;
  radius: number;
  pulsePhase: number;
  pulseSpeed: number;
  tier: 0 | 1 | 2; // 0=nexus core, 1=champion node, 2=rune particle
}

interface Beam {
  a: number; b: number; // node indices
  alpha: number;
  flowOffset: number;
}

interface HexParticle {
  x: number; y: number;
  vx: number; vy: number;
  size: number;
  rotation: number;
  rotSpeed: number;
  opacity: number;
  opacityDir: number;
}

// ─── Palette ──────────────────────────────────────────────────────────────────
const GOLD   = { r: 200, g: 168, b: 75  };
const CYAN   = { r: 255, g: 216, b: 112 }; // bright gold
const PURPLE = { r: 168, g: 128, b: 38  }; // deep gold

function rgb(c: { r: number; g: number; b: number }, a = 1) {
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}

// ─── Draw a regular hexagon ────────────────────────────────────────────────────
function drawHex(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  size: number, rotation: number,
  strokeColor: string, alpha: number,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = rotation + (Math.PI / 3) * i;
    const x = cx + Math.cos(a) * size;
    const y = cy + Math.sin(a) * size;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

// ─── Component ────────────────────────────────────────────────────────────────
export function SplineHero({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0, H = 0;
    const nodes: Node[] = [];
    const beams: Beam[] = [];
    const hexParticles: HexParticle[] = [];
    const stars: { x: number; y: number; r: number; a: number }[] = [];

    // ── Resize ──────────────────────────────────────────────────────────────
    function resize() {
      const rect = container!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = rect.width;
      H = rect.height;
      canvas!.width  = W * dpr;
      canvas!.height = H * dpr;
      canvas!.style.width  = `${W}px`;
      canvas!.style.height = `${H}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // ── Seed nodes ──────────────────────────────────────────────────────────
    function seed() {
      nodes.length = 0;
      beams.length = 0;
      hexParticles.length = 0;
      stars.length = 0;

      // Star field (background depth)
      for (let i = 0; i < 180; i++) {
        stars.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: Math.random() * 1.2,
          a: Math.random() * 0.35 + 0.05,
        });
      }

      // 1 nexus core in center-ish
      nodes.push({
        x: W * 0.5 + (Math.random() - 0.5) * W * 0.1,
        y: H * 0.48 + (Math.random() - 0.5) * H * 0.06,
        vx: 0, vy: 0,
        radius: 7,
        pulsePhase: 0,
        pulseSpeed: 0.018,
        tier: 0,
      });

      // 7 champion nodes scattered
      for (let i = 0; i < 7; i++) {
        nodes.push({
          x: W * 0.1 + Math.random() * W * 0.8,
          y: H * 0.08 + Math.random() * H * 0.84,
          vx: (Math.random() - 0.5) * 0.25,
          vy: (Math.random() - 0.5) * 0.25,
          radius: 4,
          pulsePhase: Math.random() * Math.PI * 2,
          pulseSpeed: 0.012 + Math.random() * 0.01,
          tier: 1,
        });
      }

      // 18 rune particles
      for (let i = 0; i < 18; i++) {
        nodes.push({
          x: Math.random() * W,
          y: Math.random() * H,
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4,
          radius: 1.8,
          pulsePhase: Math.random() * Math.PI * 2,
          pulseSpeed: 0.02 + Math.random() * 0.015,
          tier: 2,
        });
      }

      // Beams: connect every tier-0/1 node to nearby nodes
      const connectionRadius = Math.min(W, H) * 0.45;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          if (nodes[i].tier === 2 && nodes[j].tier === 2) continue;
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          if (Math.hypot(dx, dy) < connectionRadius) {
            beams.push({ a: i, b: j, alpha: 0, flowOffset: Math.random() });
          }
        }
      }

      // Hex particles
      for (let i = 0; i < 22; i++) {
        hexParticles.push({
          x: Math.random() * W,
          y: Math.random() * H,
          vx: (Math.random() - 0.5) * 0.15,
          vy: (Math.random() - 0.5) * 0.15,
          size: 8 + Math.random() * 28,
          rotation: Math.random() * Math.PI,
          rotSpeed: (Math.random() - 0.5) * 0.003,
          opacity: Math.random() * 0.08 + 0.02,
          opacityDir: Math.random() > 0.5 ? 1 : -1,
        });
      }
    }

    // ── Draw ────────────────────────────────────────────────────────────────
    let t = 0;
    function draw() {
      if (!ctx) return;
      t += 0.016;
      ctx.clearRect(0, 0, W, H);

      // ── 1. Stars ──────────────────────────────────────────────────────────
      for (const s of stars) {
        const twinkle = s.a * (0.6 + 0.4 * Math.sin(t * 0.7 + s.x));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = rgb(GOLD, twinkle);
        ctx.fill();
      }

      // ── 2. Hex particles ──────────────────────────────────────────────────
      for (const h of hexParticles) {
        h.x  += h.vx; h.y  += h.vy;
        h.rotation += h.rotSpeed;
        h.opacity  += h.opacityDir * 0.0004;
        if (h.opacity > 0.12 || h.opacity < 0.01) h.opacityDir *= -1;
        if (h.x < -h.size * 2) h.x = W + h.size;
        if (h.x > W + h.size * 2) h.x = -h.size;
        if (h.y < -h.size * 2) h.y = H + h.size;
        if (h.y > H + h.size * 2) h.y = -h.size;

        const color = Math.random() > 0.6 ? rgb(CYAN) : rgb(GOLD);
        drawHex(ctx, h.x, h.y, h.size, h.rotation, color, h.opacity);
      }

      // ── 3. Beams (energy connections) ─────────────────────────────────────
      for (const beam of beams) {
        const na = nodes[beam.a], nb = nodes[beam.b];
        const dx = nb.x - na.x, dy = nb.y - na.y;
        const dist = Math.hypot(dx, dy);

        // Dynamic alpha based on proximity
        const maxDist = Math.min(W, H) * 0.45;
        const proximity = 1 - dist / maxDist;
        beam.alpha = Math.max(0, proximity * 0.35);

        if (beam.alpha < 0.005) continue;

        // Tier-0 connections glow golden
        const isGold = na.tier === 0 || nb.tier === 0;
        const lineColor = isGold ? GOLD : CYAN;

        // Base line
        const grad = ctx.createLinearGradient(na.x, na.y, nb.x, nb.y);
        grad.addColorStop(0, rgb(lineColor, 0));
        grad.addColorStop(0.3, rgb(lineColor, beam.alpha));
        grad.addColorStop(0.7, rgb(lineColor, beam.alpha));
        grad.addColorStop(1, rgb(lineColor, 0));
        ctx.beginPath();
        ctx.moveTo(na.x, na.y);
        ctx.lineTo(nb.x, nb.y);
        ctx.strokeStyle = grad;
        ctx.lineWidth = isGold ? 0.7 : 0.4;
        ctx.stroke();

        // Animated energy packet traveling along the beam
        beam.flowOffset = (beam.flowOffset + 0.003) % 1;
        const fx = na.x + dx * beam.flowOffset;
        const fy = na.y + dy * beam.flowOffset;
        const gr = ctx.createRadialGradient(fx, fy, 0, fx, fy, 5);
        gr.addColorStop(0, rgb(lineColor, beam.alpha * 1.8));
        gr.addColorStop(1, rgb(lineColor, 0));
        ctx.beginPath();
        ctx.arc(fx, fy, 5, 0, Math.PI * 2);
        ctx.fillStyle = gr;
        ctx.fill();
      }

      // ── 4. Nodes ──────────────────────────────────────────────────────────
      for (const node of nodes) {
        // Move
        node.x += node.vx; node.y += node.vy;
        node.pulsePhase += node.pulseSpeed;

        // Soft bounce off edges
        const margin = 60;
        if (node.x < margin)    node.vx += 0.03;
        if (node.x > W - margin) node.vx -= 0.03;
        if (node.y < margin)    node.vy += 0.03;
        if (node.y > H - margin) node.vy -= 0.03;
        node.vx *= 0.99; node.vy *= 0.99;

        const pulse = 0.5 + 0.5 * Math.sin(node.pulsePhase);
        const color = node.tier === 0 ? GOLD : node.tier === 1 ? CYAN : PURPLE;

        // Outer glow ring
        const outerR = node.radius * (2.8 + pulse * 2);
        const outerGrd = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, outerR);
        outerGrd.addColorStop(0, rgb(color, 0.12 + pulse * 0.06));
        outerGrd.addColorStop(1, rgb(color, 0));
        ctx.beginPath();
        ctx.arc(node.x, node.y, outerR, 0, Math.PI * 2);
        ctx.fillStyle = outerGrd;
        ctx.fill();

        // Inner glow
        const innerGrd = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, node.radius * 2.2);
        innerGrd.addColorStop(0, rgb(color, 0.9));
        innerGrd.addColorStop(0.4, rgb(color, 0.5 + pulse * 0.3));
        innerGrd.addColorStop(1, rgb(color, 0));
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius * 2.2, 0, Math.PI * 2);
        ctx.fillStyle = innerGrd;
        ctx.fill();

        // Hard core
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = rgb(color, 1);
        ctx.fill();

        // Nexus core: additional concentric rings
        if (node.tier === 0) {
          for (let ring = 1; ring <= 3; ring++) {
            const ringR = node.radius * (ring * 3.5) * (0.8 + pulse * 0.2);
            ctx.beginPath();
            ctx.arc(node.x, node.y, ringR, 0, Math.PI * 2);
            ctx.strokeStyle = rgb(GOLD, (0.15 - ring * 0.04) * (0.5 + pulse * 0.5));
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
          // Rotating hex around nexus
          drawHex(ctx, node.x, node.y, node.radius * 5, t * 0.3, rgb(GOLD), 0.15 + pulse * 0.1);
          drawHex(ctx, node.x, node.y, node.radius * 7.5, -t * 0.18, rgb(GOLD), 0.07 + pulse * 0.06);
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    // ── Init ────────────────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => { resize(); seed(); });
    ro.observe(container);
    resize();
    seed();
    draw();

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={containerRef} className={`absolute inset-0 pointer-events-none ${className}`}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ opacity: 0.75, mixBlendMode: "screen" }}
      />
    </div>
  );
}
