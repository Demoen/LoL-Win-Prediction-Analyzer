"use client";

import React, { useEffect, useRef } from "react";

export function LogoGlb({ className }: { className?: string }) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        let disposed = false;
        let frameId = 0;

        async function init() {
            const canvas = canvasRef.current;
            if (!canvas) return;

            const THREE = await import("three");
            const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");

            if (disposed) return;

            const scene = new THREE.Scene();

            const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
            camera.position.set(0, 0, 2.0);

            const renderer = new THREE.WebGLRenderer({
                canvas,
                alpha: true,
                antialias: true,
                powerPreference: "low-power",
            });
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            renderer.setClearColor(0x000000, 0);

            const ambient = new THREE.AmbientLight(0xffffff, 0.85);
            const directional = new THREE.DirectionalLight(0xffffff, 1.1);
            directional.position.set(3, 3, 3);
            scene.add(ambient, directional);

            const loader = new GLTFLoader();

            const gltf = await loader.loadAsync("/logo.glb");
            if (disposed) {
                renderer.dispose();
                return;
            }

            const model = gltf.scene;

            // Center + fit to view to avoid clipping regardless of GLB's original scale/origin.
            const box = new THREE.Box3().setFromObject(model);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());

            model.position.x += -center.x;
            model.position.y += -center.y;
            model.position.z += -center.z;

            const maxDim = Math.max(size.x, size.y, size.z) || 1;
            const fitScale = 1.15 / maxDim;
            model.scale.setScalar(fitScale);

            model.rotation.set(0.15, 0.6, 0);
            scene.add(model);

            const resize = () => {
                const rect = canvas.getBoundingClientRect();
                const w = Math.max(1, Math.floor(rect.width));
                const h = Math.max(1, Math.floor(rect.height));
                renderer.setSize(w, h, false);
                camera.aspect = w / h;
                camera.updateProjectionMatrix();
            };

            const ro = new ResizeObserver(() => resize());
            ro.observe(canvas);
            resize();

            const tick = () => {
                if (disposed) return;
                model.rotation.y += 0.01;
                renderer.render(scene, camera);
                frameId = window.requestAnimationFrame(tick);
            };
            tick();

            return () => {
                ro.disconnect();
                renderer.dispose();
            };
        }

        let cleanup: void | (() => void);
        init().then((c) => {
            cleanup = c;
        });

        return () => {
            disposed = true;
            if (frameId) window.cancelAnimationFrame(frameId);
            if (cleanup) cleanup();
        };
    }, []);

    return (
        <div className={className}>
            <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
        </div>
    );
}
