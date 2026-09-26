'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
export default function Scene({
  positions,
  atoms,
  onSelect,
}: {
  positions?: number[][];
  atoms?: { id: string; element: string; position: number[] }[];
  onSelect?: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    if (!container.current) return;
    const holder = container.current;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError('WebGL 不可用。下方保留截面坐标、结构说明和数值结果。');
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(holder.clientWidth, 300);
    holder.appendChild(renderer.domElement);
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(40, holder.clientWidth / 300, 0.1, 100);
    camera.position.set(4, 3, 5);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.enablePan = false;
    scene.add(new THREE.AmbientLight(0xffffff, 2));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(3, 5, 4);
    scene.add(light);
    const meshes: THREE.Mesh[] = [];
    if (atoms) {
      for (const atom of atoms) {
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(atom.element === 'C' ? 0.24 : 0.16, 20, 16),
          new THREE.MeshStandardMaterial({
            color: atom.element === 'C' ? 0x466453 : 0xddddc4,
            roughness: 0.6,
          }),
        );
        mesh.position.fromArray(atom.position);
        mesh.userData.atomId = atom.id;
        meshes.push(mesh);
        scene.add(mesh);
        if (atom.element !== 'C') {
          const start = new THREE.Vector3(),
            end = new THREE.Vector3().fromArray(atom.position),
            direction = end.clone().sub(start),
            bond = new THREE.Mesh(
              new THREE.CylinderGeometry(0.055, 0.055, direction.length(), 12),
              new THREE.MeshStandardMaterial({ color: 0x9aab98 }),
            );
          bond.position.copy(end.multiplyScalar(0.5));
          bond.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
          scene.add(bond);
        }
      }
    } else {
      const box = new THREE.BoxGeometry(2, 2, 2);
      scene.add(
        new THREE.LineSegments(
          new THREE.EdgesGeometry(box),
          new THREE.LineBasicMaterial({ color: 0x69816b }),
        ),
      );
      box.dispose();
      if (positions && positions.length >= 3) {
        const coords: number[] = [];
        for (let i = 1; i < positions.length - 1; i++)
          coords.push(...positions[0], ...positions[i], ...positions[i + 1]);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
        geometry.computeVertexNormals();
        scene.add(
          new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({
              color: 0x79a48a,
              side: THREE.DoubleSide,
              transparent: true,
              opacity: 0.75,
            }),
          ),
        );
      }
    }
    const draw = () => renderer.render(scene, camera);
    draw();
    controls.addEventListener('change', draw);
    const resize = new ResizeObserver(() => {
      camera.aspect = holder.clientWidth / 300;
      camera.updateProjectionMatrix();
      renderer.setSize(holder.clientWidth, 300);
      draw();
    });
    resize.observe(holder);
    const select = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect(),
        mouse = new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          (-(event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        ray = new THREE.Raycaster();
      ray.setFromCamera(mouse, camera);
      const hit = ray.intersectObjects(meshes)[0];
      if (hit) onSelect?.(hit.object.userData.atomId);
    };
    renderer.domElement.addEventListener('pointerup', select);
    return () => {
      resize.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerup', select);
      scene.traverse((o) => {
        if ('geometry' in o) (o.geometry as THREE.BufferGeometry).dispose();
        if ('material' in o) {
          const material = o.material as THREE.Material | THREE.Material[];
          for (const m of Array.isArray(material) ? material : [material]) m.dispose();
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [positions, atoms]);
  return (
    <div>
      <div
        ref={container}
        style={{ minHeight: 300 }}
        aria-label={atoms ? '可旋转分子结构' : '可旋转三维截面'}
      />
      {error && <p role="alert">{error}</p>}
      <small>拖动旋转、滚轮缩放{atoms ? '，点击原子以选择。' : '。'}</small>
      {error && <pre>{JSON.stringify(atoms ?? positions, null, 2)}</pre>}
    </div>
  );
}
