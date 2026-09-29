import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface PhysicsRuntimeConfig {
  bodyType: 'auto' | 'static' | 'dynamic' | 'kinematic';
  massMode: 'auto' | 'manual';
  massKg: number;
  densityMode: 'auto' | 'manual';
  densityKgM3: number;
  friction: number;
  restitution: number;
  linearDamping: number;
  angularDamping: number;
  gravityEnabled: boolean;
}

type RapierModule = typeof import('@dimforge/rapier3d-compat');
type SimBody = {
  body: any;
  visual: THREE.Object3D;
  debug: THREE.Object3D;
  initialPosition: THREE.Vector3;
  initialQuaternion: THREE.Quaternion;
};

const loader = new GLTFLoader();

export class PhysicsRuntime {
  private rapier: RapierModule | null = null;
  private world: any = null;
  private scene: THREE.Scene | null = null;
  private floor: any = null;
  private bodies: SimBody[] = [];
  private initialized = false;
  private running = false;
  private sourceVisual: THREE.Object3D | null = null;
  private collisionDebugVisible = false;
  private accumulator = 0;
  private readonly fixedStep = 1 / 60;

  async init(
    scene: THREE.Scene,
    sourceVisual: THREE.Object3D,
    collisionUrl: string,
    config: PhysicsRuntimeConfig,
  ): Promise<void> {
    this.dispose();
    this.scene = scene;
    this.sourceVisual = sourceVisual;

    const rapier = await import('@dimforge/rapier3d-compat');
    await rapier.init();
    this.rapier = rapier;

    const gravity = config.gravityEnabled ? { x: 0, y: -9.81, z: 0 } : { x: 0, y: 0, z: 0 };
    this.world = new rapier.World(gravity);

    const collision = await loader.loadAsync(collisionUrl);
    const sourceBox = new THREE.Box3().setFromObject(sourceVisual);
    const floorY = sourceBox.min.y - 0.02;

    const floorDesc = rapier.ColliderDesc.cuboid(
      Math.max(5, sourceBox.getSize(new THREE.Vector3()).x * 4),
      0.05,
      Math.max(5, sourceBox.getSize(new THREE.Vector3()).z * 4),
    );
    floorDesc.setTranslation(sourceBox.getCenter(new THREE.Vector3()).x, floorY, sourceBox.getCenter(new THREE.Vector3()).z);
    this.floor = this.world.createCollider(floorDesc);

    const colliderPoints: Float32Array[] = [];
    const position = sourceVisual.getWorldPosition(new THREE.Vector3());
    const quaternion = sourceVisual.getWorldQuaternion(new THREE.Quaternion());
    const origin = position.clone();
    collision.scene.updateMatrixWorld(true);
    collision.scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.geometry?.attributes.position) return;
      const position = child.geometry.attributes.position;
      const points = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) {
        points[i * 3] = position.getX(i);
        points[i * 3 + 1] = position.getY(i);
        points[i * 3 + 2] = position.getZ(i);
      }
      const worldMatrix = child.matrixWorld;
      const localPoints = new Float32Array(points.length);
      const v = new THREE.Vector3();
      for (let i = 0; i < position.count; i++) {
        v.set(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]).applyMatrix4(worldMatrix);
        localPoints[i * 3] = v.x - origin.x;
        localPoints[i * 3 + 1] = v.y - origin.y;
        localPoints[i * 3 + 2] = v.z - origin.z;
      }
      if (localPoints.length >= 12) colliderPoints.push(localPoints);
    });

    const descFactory = config.bodyType === 'static'
      ? () => rapier.RigidBodyDesc.fixed()
      : config.bodyType === 'kinematic'
      ? () => rapier.RigidBodyDesc.kinematicPositionBased()
      : () => rapier.RigidBodyDesc.dynamic();

    const bodyDesc = descFactory()
      .setTranslation(position.x, position.y, position.z)
      .setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w })
      .setLinearDamping(Math.max(0, config.linearDamping))
      .setAngularDamping(Math.max(0, config.angularDamping));

    if (config.bodyType !== 'static' && config.massMode === 'manual') {
      bodyDesc.setAdditionalMass(Math.max(0.01, config.massKg));
    }

    const body = this.world.createRigidBody(bodyDesc);

    for (const points of colliderPoints) {
      const desc = rapier.ColliderDesc.convexHull(points);
      if (!desc) continue;
      desc
        .setDensity(config.massMode === 'manual' ? 0 : Math.max(0.01, config.densityKgM3))
        .setFriction(Math.max(0, Math.min(2, config.friction)))
        .setRestitution(Math.max(0, Math.min(1, config.restitution)));
      this.world.createCollider(desc, body);
    }

    const debug = this.buildDebugObject(collision.scene);
    scene.add(debug);
    this.bodies.push({
      body,
      visual: sourceVisual,
      debug,
      initialPosition: position.clone(),
      initialQuaternion: quaternion.clone(),
    });

    sourceVisual.userData.physicsRuntime = true;
    this.initialized = true;
    this.setDebugVisibility(false);
  }

  private buildDebugObject(source: THREE.Object3D): THREE.Object3D {
    const group = new THREE.Group();
    const material = new THREE.LineBasicMaterial({
      color: 0xffcc00,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });
    source.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const wire = new THREE.LineSegments(
        new THREE.WireframeGeometry(child.geometry),
        material,
      );
      wire.matrixAutoUpdate = true;
      wire.applyMatrix4(child.matrixWorld);
      group.add(wire);
    });
    return group;
  }

  setRunning(value: boolean): void {
    this.running = value;
  }

  isRunning(): boolean {
    return this.running;
  }

  isReady(): boolean {
    return this.initialized && Boolean(this.world);
  }

  setDebugVisibility(visible: boolean): void {
    this.collisionDebugVisible = visible;
    for (const body of this.bodies) body.debug.visible = visible;
  }

  reset(): void {
    this.accumulator = 0;
    for (const item of this.bodies) {
      item.body.setTranslation(item.initialPosition, true);
      item.body.setRotation(item.initialQuaternion, true);
      item.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      item.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      item.visual.position.copy(item.initialPosition);
      item.visual.quaternion.copy(item.initialQuaternion);
      item.debug.position.set(0, 0, 0);
      item.debug.quaternion.identity();
    }
  }

  applyTest(test: 'drop' | 'bounce' | 'slide' | 'spin'): void {
    if (!this.bodies.length) return;
    this.reset();
    const item = this.bodies[0];
    if (test === 'bounce') item.body.setLinvel({ x: 0, y: 3, z: 0 }, true);
    if (test === 'slide') item.body.setLinvel({ x: 2, y: 0, z: 0 }, true);
    if (test === 'spin') item.body.setAngvel({ x: 0, y: 3, z: 0 }, true);
    this.running = true;
  }

  step(): void {
    if (!this.world) return;
    this.world.step();
    this.sync();
  }

  tick(deltaSeconds = this.fixedStep): void {
    if (!this.world || !this.running) return;
    this.accumulator += Math.min(0.05, Math.max(0, deltaSeconds));
    while (this.accumulator >= this.fixedStep) {
      this.world.step();
      this.accumulator -= this.fixedStep;
    }
    this.sync();
  }

  private sync(): void {
    for (const item of this.bodies) {
      const p = item.body.translation();
      const r = item.body.rotation();
      item.visual.position.set(p.x, p.y, p.z);
      item.visual.quaternion.set(r.x, r.y, r.z, r.w);
      item.debug.position.set(p.x - item.initialPosition.x, p.y - item.initialPosition.y, p.z - item.initialPosition.z);
      item.debug.quaternion.copy(item.visual.quaternion);
    }
  }

  dispose(): void {
    this.running = false;
    this.accumulator = 0;
    for (const item of this.bodies) {
      item.debug.parent?.remove(item.debug);
      item.debug.traverse((obj) => {
        if (obj instanceof THREE.LineSegments) {
          obj.geometry.dispose();
          const material = obj.material;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material.dispose();
        }
      });
    }
    this.bodies = [];
    if (this.world && this.rapier) {
      this.world.free();
    }
    this.floor = null;
    this.world = null;
    this.rapier = null;
    this.scene = null;
    this.sourceVisual = null;
    this.initialized = false;
  }
}
