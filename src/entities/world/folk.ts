import * as THREE from 'three';

export interface VoxelFolk {
  group: THREE.Group;
  legs: [THREE.Mesh, THREE.Mesh];
  arms: [THREE.Mesh, THREE.Mesh];
  baseY: number;
  phase: number;
}

/** A little blocky character in the landing's style: box body, dot eyes. */
export function makeVoxelFolk(colorHex: number, scale: number): VoxelFolk {
  const color = new THREE.Color(colorHex);
  const mat = new THREE.MeshLambertMaterial({ color });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x14171c });
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.5, 0.28), mat);
  body.position.y = 0.62;
  body.castShadow = true;
  group.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.32, 0.32), mat);
  head.position.y = 1.05;
  head.castShadow = true;
  group.add(head);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.075, 0.02), eyeMat);
    eye.position.set(side * 0.08, 1.07, 0.17);
    group.add(eye);
  }
  const legGeo = new THREE.BoxGeometry(0.14, 0.36, 0.17);
  legGeo.translate(0, -0.18, 0);
  const armGeo = new THREE.BoxGeometry(0.1, 0.34, 0.13);
  armGeo.translate(0, -0.17, 0);
  const legs: THREE.Mesh[] = [];
  const arms: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, mat);
    leg.position.set(side * 0.12, 0.37, 0);
    leg.castShadow = true;
    group.add(leg);
    legs.push(leg);
    const arm = new THREE.Mesh(armGeo, mat);
    arm.position.set(side * 0.28, 0.84, 0);
    arm.castShadow = true;
    group.add(arm);
    arms.push(arm);
  }
  group.scale.setScalar(scale);
  return {
    group,
    legs: [legs[0]!, legs[1]!],
    arms: [arms[0]!, arms[1]!],
    baseY: 0,
    phase: Math.random() * Math.PI * 2,
  };
}

// the marbled liquid — shared by the portal's eye and the pond
