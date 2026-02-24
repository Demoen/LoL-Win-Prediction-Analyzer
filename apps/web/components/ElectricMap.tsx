"use client";

import { useEffect, useRef } from "react";

interface ElectricMapProps {
    className?: string;
}

// Lightweight deterministic noise for flicker
function hash2(x: number, y: number): number {
    let n = (x * 374761393 + y * 668265263) | 0;
    n = (n ^ (n >>> 13)) | 0;
    n = (n * 1274126177) | 0;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// Lane paths normalized [0-1] for lightning arcs
const paths = [
    // main diagonal
    [[0.12, 0.86], [0.24, 0.74], [0.36, 0.64], [0.52, 0.52], [0.64, 0.40], [0.78, 0.26], [0.88, 0.14]],
    // top lane
    [[0.10, 0.20], [0.26, 0.18], [0.42, 0.20], [0.60, 0.23], [0.78, 0.24], [0.90, 0.22]],
    // bot lane
    [[0.12, 0.88], [0.22, 0.90], [0.40, 0.86], [0.58, 0.78], [0.72, 0.64], [0.82, 0.50]],
];

export function ElectricMap({ className = "" }: ElectricMapProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const animationRef = useRef<number>(0);
    const sweepRef = useRef<number>(0);
    const t0Ref = useRef<number>(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return;

        // Load images
        const baseImg = new Image();
        const glowImg = new Image();
        baseImg.src = "/map-dark.png";
        glowImg.src = "/map-glow.png";

        // Offscreen canvas for masking
        const off = document.createElement("canvas");
        const offCtx = off.getContext("2d");

        function fitCanvas() {
            if (!canvas || !container) return;
            const rect = container.getBoundingClientRect();
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            canvas.width = Math.floor(rect.width * dpr);
            canvas.height = Math.floor(rect.height * dpr);
            canvas.style.width = `${rect.width}px`;
            canvas.style.height = `${rect.height}px`;
            ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        const resizeObserver = new ResizeObserver(fitCanvas);
        resizeObserver.observe(container);
        fitCanvas();

        function drawLightningPolyline(
            ctx: CanvasRenderingContext2D,
            pts: number[][],
            w: number,
            h: number,
            phase: number,
            strength: number
        ) {
            const p = pts.map(([nx, ny]) => ({ x: nx * w, y: ny * h }));

            // Calculate total length
            let segs: { i: number; len: number; dx: number; dy: number }[] = [];
            let total = 0;
            for (let i = 0; i < p.length - 1; i++) {
                const dx = p[i + 1].x - p[i].x;
                const dy = p[i + 1].y - p[i].y;
                const len = Math.hypot(dx, dy);
                segs.push({ i, len, dx, dy });
                total += len;
            }

            const head = phase * total;
            const tail = Math.max(0, head - total * 0.25);

            // Base crackle line
            ctx.beginPath();
            ctx.moveTo(p[0].x, p[0].y);
            for (let i = 1; i < p.length; i++) {
                const t = i / (p.length - 1);
                const jitter = (Math.sin((t * 18 + phase * 9) * Math.PI * 2) + (Math.random() - 0.5)) * 2.5;
                const jx = (Math.random() - 0.5) * 2;
                const jy = (Math.random() - 0.5) * 2;
                ctx.lineTo(p[i].x + jx + jitter, p[i].y + jy - jitter * 0.6);
            }
            ctx.lineWidth = 1.5;
            ctx.globalAlpha = 0.15 * strength;
            ctx.stroke();

            // Moving bright core
            ctx.globalAlpha = 0.85 * strength;
            ctx.lineWidth = 2.5;
            ctx.beginPath();

            let run = 0;
            let started = false;
            for (let s = 0; s < segs.length; s++) {
                const a = p[segs[s].i];
                const b = p[segs[s].i + 1];
                const segStart = run;
                const segEnd = run + segs[s].len;

                const overlapStart = Math.max(segStart, tail);
                const overlapEnd = Math.min(segEnd, head);
                if (overlapEnd > overlapStart) {
                    const t0 = (overlapStart - segStart) / segs[s].len;
                    const t1 = (overlapEnd - segStart) / segs[s].len;

                    const x0 = a.x + (b.x - a.x) * t0;
                    const y0 = a.y + (b.y - a.y) * t0;
                    const x1 = a.x + (b.x - a.x) * t1;
                    const y1 = a.y + (b.y - a.y) * t1;

                    if (!started) {
                        ctx.moveTo(x0, y0);
                        started = true;
                    }
                    ctx.lineTo(x1, y1);
                }
                run = segEnd;
            }
            ctx.stroke();
        }

        function drawSparks(ctx: CanvasRenderingContext2D, w: number, h: number, phase: number, strength: number) {
            const x = (0.08 + 0.84 * phase) * w;
            const y = (0.92 - 0.84 * phase) * h;

            const count = 12;
            for (let i = 0; i < count; i++) {
                const ang = Math.random() * Math.PI * 2;
                const spd = (0.5 + Math.random() * 2.5) * (0.6 + 1.2 * strength);
                const r = Math.random() * 12;
                const px = x + Math.cos(ang) * r;
                const py = y + Math.sin(ang) * r;
                const dx = Math.cos(ang) * spd;
                const dy = Math.sin(ang) * spd;

                ctx.globalAlpha = (0.3 + Math.random() * 0.5) * strength;
                ctx.fillRect(px + dx, py + dy, 1.5, 1.5);
            }
        }

        function ready() {
            return baseImg.complete && baseImg.naturalWidth && glowImg.complete && glowImg.naturalWidth;
        }

        t0Ref.current = performance.now();

        function frame(now: number) {
            if (!ctx || !offCtx || !canvas || !container) return;

            const dt = Math.min(0.05, (now - t0Ref.current) / 1000);
            t0Ref.current = now;

            // Animation speed
            sweepRef.current += dt * 0.09;
            if (sweepRef.current > 1.3) sweepRef.current = 0;

            const rect = container.getBoundingClientRect();
            const W = rect.width;
            const H = rect.height;

            // Fit images covering viewport
            const iw = baseImg.naturalWidth || 1;
            const ih = baseImg.naturalHeight || 1;
            const scale = Math.max(W / iw, H / ih);
            const dw = iw * scale;
            const dh = ih * scale;
            const dx = (W - dw) / 2;
            const dy = (H - dh) / 2;

            // Draw base
            ctx.globalCompositeOperation = "source-over";
            ctx.globalAlpha = 1;
            ctx.fillStyle = "#05050f";
            ctx.fillRect(0, 0, W, H);

            if (ready()) {
                ctx.globalAlpha = 0.6; // Dim the base map
                ctx.drawImage(baseImg, dx, dy, dw, dh);

                // Prepare glow mask
                off.width = Math.ceil(dw);
                off.height = Math.ceil(dh);
                offCtx.clearRect(0, 0, off.width, off.height);
                offCtx.globalCompositeOperation = "source-over";
                offCtx.globalAlpha = 1;
                offCtx.drawImage(glowImg, 0, 0, dw, dh);

                // Sweeping mask
                const phase = Math.max(0, Math.min(1, sweepRef.current));
                const cx = (0.08 + 0.84 * phase) * dw;
                const cy = (0.92 - 0.84 * phase) * dh;

                const band = Math.max(dw, dh) * 0.28;
                const g = offCtx.createLinearGradient(cx - band, cy + band, cx + band, cy - band);

                const edge = 0.12 + 0.02 * Math.sin(now * 0.005);
                g.addColorStop(0.0, "rgba(0,0,0,0)");
                g.addColorStop(Math.max(0, 0.5 - edge), "rgba(0,0,0,0)");
                g.addColorStop(0.5, "rgba(0,0,0,1)");
                g.addColorStop(Math.min(1, 0.5 + edge), "rgba(0,0,0,0)");
                g.addColorStop(1.0, "rgba(0,0,0,0)");

                offCtx.globalCompositeOperation = "destination-in";
                offCtx.fillStyle = g;
                offCtx.fillRect(0, 0, dw, dh);

                // Draw masked glow with additive blend
                ctx.globalCompositeOperation = "lighter";
                const n = hash2((now * 0.02) | 0, (now * 0.013) | 0);
                const flicker = 0.82 + n * 0.38;
                ctx.globalAlpha = 0.9 * flicker;
                ctx.drawImage(off, dx, dy);

                // Lightning arcs
                ctx.save();
                ctx.translate(dx, dy);
                ctx.globalCompositeOperation = "lighter";
                ctx.strokeStyle = "rgba(180,230,255,1)";
                ctx.fillStyle = "rgba(180,230,255,1)";

                const strength = Math.max(0, Math.min(1, phase * 1.3));
                const p = (phase + now * 0.00025) % 1;

                for (let i = 0; i < paths.length; i++) {
                    drawLightningPolyline(ctx, paths[i], dw, dh, (p + i * 0.2) % 1, 0.45 * strength);
                }

                // Main diagonal crackle
                drawLightningPolyline(
                    ctx,
                    [[0.10, 0.90], [0.34, 0.66], [0.54, 0.50], [0.70, 0.32], [0.90, 0.12]],
                    dw,
                    dh,
                    p,
                    0.8 * strength
                );

                // Sparks
                drawSparks(ctx, dw, dh, phase, 0.85 * strength);
                ctx.restore();

                // Vignette
                ctx.globalCompositeOperation = "source-over";
                const vg = ctx.createRadialGradient(
                    W * 0.5, H * 0.5, Math.min(W, H) * 0.2,
                    W * 0.5, H * 0.5, Math.max(W, H) * 0.7
                );
                vg.addColorStop(0, "rgba(5,5,15,0)");
                vg.addColorStop(1, "rgba(5,5,15,0.7)");
                ctx.fillStyle = vg;
                ctx.fillRect(0, 0, W, H);
            }

            animationRef.current = requestAnimationFrame(frame);
        }

        function start() {
            if (!ready()) {
                requestAnimationFrame(start);
                return;
            }
            animationRef.current = requestAnimationFrame(frame);
        }

        start();

        return () => {
            resizeObserver.disconnect();
            cancelAnimationFrame(animationRef.current);
        };
    }, []);

    return (
        <div ref={containerRef} className={`w-full h-full ${className}`}>
            <canvas
                ref={canvasRef}
                className="w-full h-full"
            />
        </div>
    );
}
