import { useEffect, useRef, useCallback } from 'react';
import createGlobe from 'cobe';
import type { COBEOptions, Marker, Arc } from 'cobe';
import { useTheme } from 'next-themes';

// Major cities representing global connectivity
const MARKERS: Marker[] = [
  { location: [37.78, -122.44], size: 0.04 },   // San Francisco
  { location: [40.71, -74.01], size: 0.04 },     // New York
  { location: [51.51, -0.13], size: 0.04 },      // London
  { location: [48.86, 2.35], size: 0.03 },       // Paris
  { location: [35.68, 139.65], size: 0.04 },     // Tokyo
  { location: [1.35, 103.82], size: 0.03 },      // Singapore
  { location: [-33.87, 151.21], size: 0.03 },    // Sydney
  { location: [28.61, 77.21], size: 0.03 },      // Delhi
  { location: [55.76, 37.62], size: 0.03 },      // Moscow
  { location: [-23.55, -46.63], size: 0.03 },    // São Paulo
  { location: [19.43, -99.13], size: 0.03 },     // Mexico City
  { location: [25.2, 55.27], size: 0.03 },       // Dubai
];

// Arcs connecting major meeting hubs
const ARCS: Arc[] = [
  { from: [37.78, -122.44], to: [51.51, -0.13] },     // SF → London
  { from: [40.71, -74.01], to: [48.86, 2.35] },       // NYC → Paris
  { from: [51.51, -0.13], to: [35.68, 139.65] },      // London → Tokyo
  { from: [1.35, 103.82], to: [-33.87, 151.21] },     // Singapore → Sydney
  { from: [28.61, 77.21], to: [25.2, 55.27] },        // Delhi → Dubai
  { from: [37.78, -122.44], to: [35.68, 139.65] },    // SF → Tokyo
  { from: [40.71, -74.01], to: [-23.55, -46.63] },    // NYC → São Paulo
  { from: [51.51, -0.13], to: [28.61, 77.21] },       // London → Delhi
];

interface GlobeProps {
  className?: string;
  size?: number;
}

export function Globe({ className = '', size = 600 }: GlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phiRef = useRef(0);
  const globeRef = useRef<ReturnType<typeof createGlobe> | null>(null);
  const frameRef = useRef<number>(0);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const getGlobeOptions = useCallback(
    (width: number, height: number): COBEOptions => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      return {
        devicePixelRatio: dpr,
        width: width * dpr,
        height: height * dpr,
        phi: 0,
        theta: 0.25,
        dark: isDark ? 1 : 0,
        diffuse: isDark ? 1.4 : 1.2,
        mapSamples: 20000,
        mapBrightness: isDark ? 2.5 : 6,
        mapBaseBrightness: isDark ? 0.08 : 0.02,
        // Blue-tinted base matching --meet-accent
        baseColor: isDark ? [0.15, 0.25, 0.45] : [0.95, 0.97, 1.0],
        // Cyan-blue markers matching the accent
        markerColor: isDark
          ? [0.36, 0.64, 1.0]   // ~#5ba2ff
          : [0.06, 0.44, 1.0],  // ~#0f6fff
        glowColor: isDark
          ? [0.08, 0.15, 0.35]
          : [0.85, 0.92, 1.0],
        markers: MARKERS,
        arcs: ARCS,
        arcColor: isDark
          ? [0.36, 0.64, 1.0]
          : [0.06, 0.44, 1.0],
        arcWidth: 0.4,
        arcHeight: 0.3,
        opacity: isDark ? 0.92 : 1,
        scale: 1.05,
        offset: [0, 0],
      };
    },
    [isDark],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const container = canvas.parentElement;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Destroy previous instance if theme changes
    if (globeRef.current) {
      globeRef.current.destroy();
      globeRef.current = null;
    }

    const globe = createGlobe(canvas, getGlobeOptions(width, height));
    globeRef.current = globe;

    function animate() {
      phiRef.current += 0.003;
      globe.update({ phi: phiRef.current });
      frameRef.current = requestAnimationFrame(animate);
    }
    animate();

    return () => {
      cancelAnimationFrame(frameRef.current);
      globe.destroy();
      globeRef.current = null;
    };
  }, [getGlobeOptions]);

  return (
    <div
      className={`globe-container ${className}`}
      style={{
        width: size,
        height: size,
        maxWidth: '100%',
        aspectRatio: '1',
        position: 'relative',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          contain: 'layout paint size',
          cursor: 'grab',
        }}
      />
      {/* Radial fade at edges to blend into background */}
      <div
        className="globe-fade"
        style={{
          position: 'absolute',
          inset: '-2px',
          borderRadius: '50%',
          pointerEvents: 'none',
          background: isDark
            ? 'radial-gradient(circle at 50% 50%, transparent 54%, rgba(7,15,28,0.5) 68%, rgba(7,15,28,0.95) 80%)'
            : 'radial-gradient(circle at 50% 50%, transparent 54%, rgba(242,247,255,0.5) 68%, rgba(242,247,255,0.95) 80%)',
        }}
      />
    </div>
  );
}
