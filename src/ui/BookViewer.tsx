import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Repo } from '../types';
import { bookHeight, bookThickness } from '../derive';
import { bookTextures, pageEdgeTexture, sideColor } from '../scene/textures';
import { BOOK_DEPTH, catalogBookDimensions } from '../scene/layout';

/** Thickness of the front board. */
const COVER_T = 0.05;
/** How far the cover swings open (radians, just short of flat). */
const OPEN_ANGLE = -2.8;
/** Resting three-quarter turn: mostly cover, a sliver of spine. */
const COVER_TURN = -Math.PI / 2 + 0.38;

function dims(repo: Repo): { width: number; height: number } {
  if (repo.catalog) return catalogBookDimensions(repo);
  const stars = repo.github?.stars ?? 0;
  return {
    width: repo.virtual ? bookThickness(stars * 40 + 400) : bookThickness(repo.sizeKB),
    height: repo.virtual ? bookHeight(stars * 4 + 60) : bookHeight(repo.commitCount),
  };
}

let shadowTex: THREE.CanvasTexture | null = null;
function softShadow(): THREE.CanvasTexture {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.5)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

function ViewerBook({ repo, staleDays, open, reducedMotion }: { repo: Repo; staleDays: number; open: boolean; reducedMotion: boolean }) {
  const group = useRef<THREE.Group>(null);
  const hinge = useRef<THREE.Group>(null);
  const { invalidate, camera, pointer, size } = useThree();
  const { width, height } = dims(repo);
  const anim = useRef({ rot: 0, open: 0, tilt: 0 });

  const mats = useMemo(() => {
    const { spine, cover, page } = bookTextures(repo, staleDays, true);
    const side = sideColor(repo, staleDays);
    const edge = pageEdgeTexture();
    const mk = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0.02, ...o });
    const body = [
      mk(page ? { map: page, roughness: 0.95 } : { color: '#efe8d8' }), // +x first page
      mk({ map: edge, roughness: 0.98 }), // -x fore-edge
      mk({ map: edge, roughness: 0.98 }), // +y head
      mk({ map: edge, roughness: 0.98 }), // -y tail
      mk({ map: spine }), // +z spine
      mk({ color: side, roughness: 0.8 }), // -z back board
    ];
    const coverMats = [
      mk(cover ? { map: cover } : { color: side }), // +x front cover
      mk({ color: '#efe8d8', roughness: 0.95 }), // -x inside of the cover
      mk({ color: side, roughness: 0.8 }),
      mk({ color: side, roughness: 0.8 }),
      mk({ color: side, roughness: 0.8 }),
      mk({ color: side, roughness: 0.8 }),
    ];
    return { body, cover: coverMats };
  }, [repo, staleDays]);
  useEffect(() => () => [...mats.body, ...mats.cover].forEach((m) => m.dispose()), [mats]);

  // A new book arrives spine-first, as it sat on the shelf, then turns to show its cover.
  useEffect(() => {
    anim.current = reducedMotion ? { rot: COVER_TURN, open: 0, tilt: 0 } : { rot: 0, open: 0, tilt: 0 };
    invalidate();
  }, [repo.id, reducedMotion, invalidate]);

  useEffect(() => {
    invalidate();
  }, [open, invalidate]);

  useFrame((_, delta) => {
    const g = group.current;
    const h = hinge.current;
    if (!g || !h) return;
    const a = anim.current;
    const targetRot = open ? -Math.PI / 2 : COVER_TURN + pointer.x * 0.12;
    const targetOpen = open ? OPEN_ANGLE : 0;
    const targetTilt = open ? 0 : -pointer.y * 0.06;
    const k = reducedMotion ? 1 : 1 - Math.exp(-delta * 7);
    // The cover waits until the book has nearly turned, like a hand opening it.
    const kOpen = reducedMotion ? 1 : 1 - Math.exp(-delta * (Math.abs(targetRot - a.rot) > 0.3 && targetOpen !== 0 ? 1.5 : 6));
    a.rot += (targetRot - a.rot) * k;
    a.open += (targetOpen - a.open) * kOpen;
    a.tilt += (targetTilt - a.tilt) * k;
    g.rotation.set(a.tilt, a.rot, 0);
    // Opened, the spread is twice as wide: slide it so both pages stay centred.
    g.position.x = (a.open / OPEN_ANGLE) * BOOK_DEPTH * 0.5;
    h.rotation.y = a.open;
    // Frame the closed book by its height, the open spread by its width, whichever needs more room.
    const cam = camera as THREE.PerspectiveCamera;
    const f = a.open / OPEN_ANGLE;
    const halfTan = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const aspect = size.width / Math.max(1, size.height);
    const fitH = (height * 1.18) / 2 / halfTan;
    const fitW = ((BOOK_DEPTH * (1 + f) + width) * 1.12) / 2 / (halfTan * aspect);
    cam.position.set(0, 0.02, Math.max(fitH, fitW) + width);
    cam.lookAt(0, 0, 0);
    if (Math.abs(targetRot - a.rot) > 0.001 || Math.abs(targetOpen - a.open) > 0.001 || Math.abs(targetTilt - a.tilt) > 0.0005) invalidate();
  });

  const bodyW = width - COVER_T;
  return (
    <group>
      <group ref={group}>
        <mesh material={mats.body} position={[-COVER_T / 2, 0, 0]}>
          <boxGeometry args={[bodyW, height, BOOK_DEPTH]} />
        </mesh>
        <group ref={hinge} position={[width / 2 - COVER_T, 0, BOOK_DEPTH / 2]}>
          <mesh material={mats.cover} position={[COVER_T / 2, 0, -BOOK_DEPTH / 2]}>
            <boxGeometry args={[COVER_T, height, BOOK_DEPTH]} />
          </mesh>
        </group>
      </group>
      <mesh position={[0, -height / 2 - 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[3.6, 2.6]} />
        <meshBasicMaterial map={softShadow()} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

/** The opened book in its own small scene: the shelf spine turns into a cover, and the cover opens on the first page. */
export function BookViewer({ repo, staleDays, open, onToggle }: { repo: Repo; staleDays: number; open: boolean; onToggle: () => void }) {
  const reducedMotion = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  return (
    <button className={`book-viewer ${open ? 'open' : ''}`} onClick={onToggle} aria-label={open ? 'Close the cover' : 'Open the cover to the first page'} title={open ? 'Close the cover' : 'Open the cover'}>
      <Canvas frameloop="demand" dpr={[1, 2]} camera={{ fov: 30, position: [0, 0, 6] }} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={0.8} />
        <hemisphereLight args={['#fff4e2', '#3a2a1e', 0.5]} />
        <directionalLight position={[2.5, 3, 5]} intensity={1.8} color="#fff3e2" />
        <directionalLight position={[-4, 1, 2]} intensity={0.4} color="#dde6ff" />
        <ViewerBook repo={repo} staleDays={staleDays} open={open} reducedMotion={reducedMotion} />
      </Canvas>
    </button>
  );
}
