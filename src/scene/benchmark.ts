import { useWall } from './wallStore';

export interface WallBenchmark {
  viewport: [number, number];
  devicePixelRatio: number;
  spines: number;
  seconds: number;
  renderedFrames: number;
  fps: number;
  frameGapMs: { p50: number; p95: number };
  renderCallMs: { p50: number; p95: number };
  stats: unknown;
}

const pct = (xs: number[], p: number) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(xs.length * p))] : 0);

/**
 * Glide from one end of the wall to the other and report the frame rate and
 * texture cache. Run it in the browser console: `await __measureWall()`.
 */
export async function measureWall(seconds = 12): Promise<WallBenchmark> {
  const w = window as unknown as {
    __r3f?: { gl: { render: (s: unknown, c: unknown) => void } };
    __wallStats?: () => unknown;
  };
  const gl = w.__r3f?.gl;
  const { layout, size } = useWall.getState();
  if (!gl || !layout) throw new Error('The wall is not ready yet.');
  const frames: [number, number][] = [];
  const render = gl.render;
  gl.render = (scene: unknown, camera: unknown) => {
    const t0 = performance.now();
    render.call(gl, scene, camera);
    frames.push([t0, performance.now() - t0]);
  };
  const before = { ...useWall.getState().target };
  const from = size.width / 2;
  const to = Math.max(from, layout.width - size.width / 2);
  const start = performance.now();
  try {
    await new Promise<void>((resolve) => {
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / (seconds * 1000));
        useWall.getState().setTarget({ zoom: 1, x: from + (to - from) * t });
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  } finally {
    gl.render = render;
    useWall.getState().setTarget(before);
  }
  const js = frames.map(([, d]) => d).sort((a, b) => a - b);
  const gaps = frames
    .slice(1)
    .map(([t], i) => t - frames[i][0])
    .sort((a, b) => a - b);
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    viewport: [size.width, Math.round(size.height)],
    devicePixelRatio: window.devicePixelRatio,
    spines: layout.spines.length,
    seconds,
    renderedFrames: frames.length,
    fps: round(frames.length / seconds),
    frameGapMs: { p50: round(pct(gaps, 0.5)), p95: round(pct(gaps, 0.95)) },
    renderCallMs: { p50: round(pct(js, 0.5)), p95: round(pct(js, 0.95)) },
    stats: w.__wallStats?.(),
  };
}

declare global {
  interface Window {
    __measureWall?: typeof measureWall;
  }
}
if (typeof window !== 'undefined') window.__measureWall = measureWall;
