import { Canvas, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { Wall } from './Wall';
import { WallCamera, WALL_FOV } from './WallCamera';
import { useShelf } from '../store';
import { themeById } from '../themes';

/** Exposes the renderer for the desktop widget's self-check and for debugging (window.__r3f). */
function SceneDebug() {
  const advance = useThree((st) => st.advance);
  const invalidate = useThree((st) => st.invalidate);
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    (window as unknown as { __r3f?: unknown }).__r3f = {
      gl,
      scene,
      camera,
      advance,
      invalidate,
      snapshot: () => {
        gl.render(scene, camera);
        return gl.domElement.toDataURL('image/png');
      },
    };
  }, [gl, scene, camera, advance, invalidate]);
  return null;
}

export function Scene() {
  const theme = useShelf((s) => themeById(s.themeId));
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.5]}
      camera={{ fov: WALL_FOV, near: 10, far: 20000, position: [0, 0, 3000] }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      style={{ touchAction: 'none' }}
    >
      <color attach="background" args={[theme.scene.background]} />
      <ambientLight intensity={theme.dark ? 0.95 : 0.85} />
      <hemisphereLight args={['#fff4e2', '#2a1d14', 0.55]} />
      {/* Warm key light from above and in front, like a library ceiling lamp. */}
      <directionalLight position={[-0.25, 0.75, 1]} intensity={1.55} color="#fff1dc" />
      <directionalLight position={[0.6, -0.2, 0.7]} intensity={0.22} color="#dfe8ff" />
      <SceneDebug />
      <WallCamera />
      <Wall />
    </Canvas>
  );
}
