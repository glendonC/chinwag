import { useEffect, useRef, useMemo, type ReactNode } from 'react';
import createGlobe from 'cobe';
import { COUNTRY_COORDS } from './countryCoords.js';
import styles from './GlobalMap.module.css';

interface Props {
  countries: Record<string, number>;
  online: number;
}

const GLOBE_PX = 480;

// Cobe "pulse" showcase - designed for live activity on dark globe
const MARKER_COLOR: [number, number, number] = [0.2, 0.8, 0.9];

export default function GlobalMap({ countries, online }: Props): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phiRef = useRef(0);

  const markers = useMemo(() => {
    const entries = Object.entries(countries).filter(([cc]) => cc in COUNTRY_COORDS);
    if (entries.length === 0) return [];

    return entries.map(([cc]) => {
      const [lat, lng] = COUNTRY_COORDS[cc];
      return {
        location: [lat, lng] as [number, number],
        size: 0.025,
      };
    });
  }, [countries]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const globe = createGlobe(canvas, {
      devicePixelRatio: dpr,
      width: GLOBE_PX * dpr,
      height: GLOBE_PX * dpr,
      phi: 0,
      theta: 0.25,
      dark: 1,
      diffuse: 1.5,
      mapSamples: 16000,
      mapBrightness: 10,
      baseColor: [0.5, 0.5, 0.5],
      markerColor: MARKER_COLOR,
      glowColor: [0.15, 0.15, 0.2],
      markers,
      scale: 1,
      offset: [0, 0],
      opacity: 0.85,
      markerElevation: 0,
      arcColor: [0.3, 0.85, 0.95] as [number, number, number],
    });

    let animationId: number;
    function animate() {
      phiRef.current += 0.003;
      globe.update({ phi: phiRef.current, markers });
      animationId = requestAnimationFrame(animate);
    }
    animate();

    requestAnimationFrame(() => {
      if (canvas) canvas.style.opacity = '1';
    });

    return () => {
      cancelAnimationFrame(animationId);
      globe.destroy();
    };
  }, [markers]);

  return (
    <div className={styles.wrap}>
      <div className={styles.overlay}>
        <span className={styles.onlineCount}>{online.toLocaleString()}</span>
        <span className={styles.onlineLabel}>
          {online === 1 ? 'Developer Online' : 'Developers Online'}
        </span>
      </div>
      <canvas ref={canvasRef} className={styles.globe} style={{ opacity: 0 }} />
    </div>
  );
}
