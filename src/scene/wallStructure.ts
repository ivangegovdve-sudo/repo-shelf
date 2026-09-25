import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WALL, rowBaseY, type WallLayout } from './wall';

/** Board with wood grain in world space, so a 1,500 px plank is not one stretched texture. */
function board(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, vertical = false): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let u: number;
    let v: number;
    if (Math.abs(nor.getZ(i)) > 0.5) [u, v] = vertical ? [y, x] : [x, y];
    else if (Math.abs(nor.getY(i)) > 0.5) [u, v] = [x, z];
    else [u, v] = vertical ? [y, z] : [z, y];
    uv.setXY(i, u / 640, v / 160);
  }
  return g;
}

function quad(x0: number, x1: number, y0: number, y1: number, z: number, uvs: [number, number, number, number, number, number, number, number]): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, z);
  // PlaneGeometry vertex order: top-left, top-right, bottom-left, bottom-right.
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

export interface WallStructure {
  frame: THREE.BufferGeometry;
  planks: THREE.BufferGeometry;
  back: THREE.BufferGeometry;
  shade: THREE.BufferGeometry;
  metal: THREE.BufferGeometry | null;
}

/**
 * The bookcase: end panels, full-height divider boards between bays, a plank
 * under every row, cornice and plinth, a back panel per cubby, and baked
 * shade (under each plank, along each divider) instead of shadow maps.
 */
export function buildStructure(layout: WallLayout): WallStructure {
  const { metrics: m, width: W, height: H } = layout;
  const back = -WALL.DEPTH - 12;
  const frame: THREE.BufferGeometry[] = [];
  const planks: THREE.BufferGeometry[] = [];
  const panels: THREE.BufferGeometry[] = [];
  const shade: THREE.BufferGeometry[] = [];
  const metal: THREE.BufferGeometry[] = [];

  const top = H - WALL.TOP;
  // Carcass back: closes every gap a low or high viewpoint could see through.
  frame.push(board(0, W, 0, H, back - 10, back - 1));
  // End panels, cornice with a crown, plinth with a kick board.
  frame.push(board(0, WALL.END, 0, H, back - 8, 18, true));
  frame.push(board(W - WALL.END, W, 0, H, back - 8, 18, true));
  frame.push(board(WALL.END, W - WALL.END, top, H - 10, back, 16));
  frame.push(board(0, W, H - 10, H, back - 8, 26));
  frame.push(board(WALL.END, W - WALL.END, top - 4, top + 6, 0, 22));
  frame.push(board(WALL.END, W - WALL.END, 0, WALL.BOTTOM - WALL.PLANK, back, 16));
  frame.push(board(0, W, 0, 12, back - 8, 24));

  layout.bays.forEach((bay, b) => {
    const x0 = bay.x;
    const x1 = bay.x + bay.width;
    if (b < layout.bays.length - 1) frame.push(board(x1, x1 + WALL.DIVIDER, WALL.BOTTOM - WALL.PLANK, top, back, 14, true));
    else if (x1 < W - WALL.END) frame.push(board(x1, W - WALL.END, WALL.BOTTOM - WALL.PLANK, top, back, 14, true));
    for (let r = 0; r < m.rows; r++) {
      const base = rowBaseY(m, r);
      const ceiling = r === 0 ? top - 4 : rowBaseY(m, r - 1) - WALL.PLANK;
      planks.push(board(x0, x1, base - WALL.PLANK, base, back, 10));
      panels.push(quad(x0, x1, base, ceiling, back + 0.5, [0, 1, 1, 1, 0, 0, 1, 0]));
      // Shade cast by the plank (or cornice) above, falling over the upper part of the books.
      shade.push(quad(x0, x1, ceiling - 70, ceiling, 1.2, [0, 1, 1, 1, 0, 0, 1, 0]));
      // Shade along both dividers.
      shade.push(quad(x0, x0 + 30, base, ceiling, 1.1, [0.5, 0.62, 0.5, 0, 0.5, 0.62, 0.5, 0]));
      shade.push(quad(x1 - 30, x1, base, ceiling, 1.1, [0.5, 0, 0.5, 0.62, 0.5, 0, 0.5, 0.62]));
    }
    // A bronze bookend after the last book when the bottom row has room.
    const lastRow = bay.rows[bay.rows.length - 1];
    if (lastRow && lastRow[1] > lastRow[0]) {
      const last = layout.spines[lastRow[1] - 1];
      const bx = last.x + last.w + 3;
      if (bx + 8 < x1 - WALL.BAY_PAD) {
        metal.push(board(bx, bx + 3.5, last.y, last.y + Math.min(64, last.h * 0.45), -WALL.DEPTH + 18, -8));
        metal.push(board(bx, bx + 42, last.y, last.y + 2, -WALL.DEPTH + 18, -8));
      }
    }
  });
  if (!layout.bays.length) planks.push(board(WALL.END, W - WALL.END, WALL.BOTTOM - WALL.PLANK, WALL.BOTTOM, back, 10));

  return {
    frame: mergeGeometries(frame)!,
    planks: mergeGeometries(planks)!,
    back: mergeGeometries(panels.length ? panels : [quad(0, W, 0, H, back, [0, 1, 1, 1, 0, 0, 1, 0])])!,
    shade: mergeGeometries(shade.length ? shade : [quad(0, 1, 0, 1, -999, [0, 0, 0, 0, 0, 0, 0, 0])])!,
    metal: metal.length ? mergeGeometries(metal) : null,
  };
}

let shadeTex: THREE.CanvasTexture | null = null;
/** Alpha ramp: v = 1 fully shaded, v = 0 clear, eased so the shade feels soft. */
export function shadeTexture(): THREE.CanvasTexture {
  if (shadeTex) return shadeTex;
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  for (let row = 0; row < 128; row++) {
    const t = 1 - row / 127;
    ctx.fillStyle = `rgba(0,0,0,${(t * t * (3 - 2 * t)) ** 1.6})`;
    ctx.fillRect(0, row, 4, 1);
  }
  shadeTex = new THREE.CanvasTexture(canvas);
  shadeTex.colorSpace = THREE.NoColorSpace;
  return shadeTex;
}
