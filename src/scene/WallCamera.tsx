import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useShelf } from '../store';
import { useWall, wallView } from './wallStore';

/** Narrow field of view: the wall reads almost flat, but pulled-out books and board edges still have depth. */
export const WALL_FOV = 20;
const HALF_TAN = Math.tan(THREE.MathUtils.degToRad(WALL_FOV / 2));

/** Distance at which the z = 0 plane shows `height / zoom` world px across the canvas height. */
export function cameraDistance(height: number, zoom: number): number {
  return height / 2 / zoom / HALF_TAN;
}

const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const hit = new THREE.Vector3();

/** World point on the wall face under a client (CSS) coordinate. */
export function wallPoint(camera: THREE.Camera, el: HTMLElement, clientX: number, clientY: number): THREE.Vector3 | null {
  const r = el.getBoundingClientRect();
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.ray.intersectPlane(plane, hit);
}

export function WallCamera() {
  const { camera, gl, invalidate, size } = useThree();
  const cur = useRef<{ x: number; y: number; zoom: number } | null>(null);

  useEffect(() => useWall.subscribe(() => invalidate()), [invalidate]);

  // Wheel: along the wall (vertical wheels too); ctrl / cmd / pinch zooms around the pointer.
  useEffect(() => {
    const el = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const wall = useWall.getState();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1;
      if (e.ctrlKey || e.metaKey) {
        const p = wallPoint(camera, el, e.clientX, e.clientY);
        wall.zoomAt(wall.target.zoom * Math.exp(-e.deltaY * unit * 0.0022), p ? { x: p.x, y: p.y } : undefined);
        return;
      }
      const along = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      wall.scrollBy((along * unit) / wall.target.zoom);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [gl, camera]);

  useFrame((_, delta) => {
    const { target, layout } = useWall.getState();
    if (!layout) return;
    const cam = camera as THREE.PerspectiveCamera;
    const c = (cur.current ??= { ...target });
    const instant = useShelf.getState().instant;
    const k = instant || wallView.snap ? 1 : 1 - Math.exp(-delta * 11);
    wallView.snap = false;
    c.x += (target.x - c.x) * k;
    c.y += (target.y - c.y) * k;
    c.zoom = Math.exp(Math.log(c.zoom) + (Math.log(target.zoom) - Math.log(c.zoom)) * k);
    if (Math.abs(target.x - c.x) < 0.05) c.x = target.x;
    if (Math.abs(target.y - c.y) < 0.05) c.y = target.y;
    if (Math.abs(target.zoom - c.zoom) < 0.0005) c.zoom = target.zoom;

    const dist = cameraDistance(size.height, c.zoom);
    if (cam.fov !== WALL_FOV || Math.abs(cam.far - (dist + 1200)) > 1) {
      cam.fov = WALL_FOV;
      cam.near = Math.max(1, dist - 1200);
      cam.far = dist + 1200;
      cam.updateProjectionMatrix();
    }
    cam.position.set(c.x, c.y, dist);
    cam.lookAt(c.x, c.y, 0);
    cam.updateMatrixWorld();

    wallView.zoom = c.zoom;
    wallView.x0 = c.x - size.width / 2 / c.zoom;
    wallView.x1 = c.x + size.width / 2 / c.zoom;
    wallView.y0 = c.y - size.height / 2 / c.zoom;
    wallView.y1 = c.y + size.height / 2 / c.zoom;

    if (c.x !== target.x || c.y !== target.y || c.zoom !== target.zoom) invalidate();
  }, -1);

  return null;
}
