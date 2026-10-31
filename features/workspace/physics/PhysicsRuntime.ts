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

    const rapier = await import('@dimforge/rapier3d-compat');
    await rapier.init();
    this.rapier = rapier;

    // Load collision geometry first before creating any physics world
    const collision = await loader.loadAsync(collisionUrl);

    this.scene = scene;
    this.sourceVisual = sourceVisual;

    const gravity = config.gravityEnabled ? { x: 0, y: -9.81, z: 0 } : { x: 0, y: 0, z: 0 };
    this.world = new rapier.World(gravity);

    sourceVisual.updateMatrixWorld(true);
    const sourceBox = new THREE.Box3().setFromObject(sourceVisual);
    const size = sourceBox.getSize(new THREE.Vector3());
    const center = sourceBox.getCenter(new THREE.Vector3());

    const floorSizeX = Number.isFinite(size.x) ? Math.max(5, size.x * 4) : 10;
    const floorSizeZ = Number.isFinite(size.z) ? Math.max(5, size.z * 4) : 10;
    const floorCenterX = Number.isFinite(center.x) ? center.x : 0;
    const floorCenterZ = Number.isFinite(center.z) ? center.z : 0;
    const floorY = Number.isFinite(sourceBox.min.y) ? sourceBox.min.y - 0.02 : -1;

    try {
      const floorDesc = rapier.ColliderDesc.cuboid(floorSizeX, 0.05, floorSizeZ);
      floorDesc.setTranslation(floorCenterX, floorY, floorCenterZ);
      this.floor = this.world.createCollider(floorDesc);
    } catch (err) {
      console.warn('[PhysicsRuntime] Failed to create floor collider:', err);
    }

    const bodyPosition = sourceVisual.getWorldPosition(new THREE.Vector3());
    const bodyQuaternion = sourceVisual
      .getWorldQuaternion(new THREE.Quaternion())
      .normalize();
    const inverseBodyRotation = bodyQuaternion.clone().invert();

    const colliderPoints: Float32Array[] = [];
    collision.scene.updateMatrixWorld(true);
    collision.scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.geometry?.attributes?.position) return;

      const position = child.geometry.attributes.position;
      if (position.count < 4) return;
      const points = new Float32Array(position.count * 3);
      const v = new THREE.Vector3();
      let hasInvalid = false;

      for (let i = 0; i < position.count; i++) {
        const rawX = position.getX(i);
        const rawY = position.getY(i);
        const rawZ = position.getZ(i);
        if (!Number.isFinite(rawX) || !Number.isFinite(rawY) || !Number.isFinite(rawZ)) {
          hasInvalid = true;
          break;
        }

        v.set(rawX, rawY, rawZ)
          .applyMatrix4(child.matrixWorld)
          .sub(bodyPosition)
          .applyQuaternion(inverseBodyRotation);

        if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) {
          hasInvalid = true;
          break;
        }

        points[i * 3] = v.x;
        points[i * 3 + 1] = v.y;
        points[i * 3 + 2] = v.z;
      }

      if (!hasInvalid && points.length >= 12) colliderPoints.push(points);
    });

    if (!colliderPoints.length) {
      throw new Error('Physics collision artifact contains no usable convex geometry.');
    }

    const descFactory = config.bodyType === 'static'
      ? () => rapier.RigidBodyDesc.fixed()
      : config.bodyType === 'kinematic'
      ? () => rapier.RigidBodyDesc.kinematicPositionBased()
      : () => rapier.RigidBodyDesc.dynamic();

    const bodyDesc = descFactory()
      .setTranslation(
        Number.isFinite(bodyPosition.x) ? bodyPosition.x : 0,
        Number.isFinite(bodyPosition.y) ? bodyPosition.y : 0,
        Number.isFinite(bodyPosition.z) ? bodyPosition.z : 0,
      )
      .setRotation({
        x: Number.isFinite(bodyQuaternion.x) ? bodyQuaternion.x : 0,
        y: Number.isFinite(bodyQuaternion.y) ? bodyQuaternion.y : 0,
        z: Number.isFinite(bodyQuaternion.z) ? bodyQuaternion.z : 0,
        w: Number.isFinite(bodyQuaternion.w) ? bodyQuaternion.w : 1,
      })
      .setLinearDamping(Math.max(0, Number.isFinite(config.linearDamping) ? config.linearDamping : 0.05))
      .setAngularDamping(Math.max(0, Number.isFinite(config.angularDamping) ? config.angularDamping : 0.05));

    if (config.bodyType !== 'static') {
      bodyDesc.setAdditionalMass(Math.max(0.01, Number.isFinite(config.massKg) ? config.massKg : 1));
    }

    const body = this.world.createRigidBody(bodyDesc);
    let colliderCount = 0;

    for (const points of colliderPoints) {
      try {
        const desc = rapier.ColliderDesc.convexHull(points);
        if (!desc || !(desc as any).raw) continue;
        desc
          .setDensity(0)
          .setFriction(Math.max(0, Math.min(2, Number.isFinite(config.friction) ? config.friction : 0.5)))
          .setRestitution(Math.max(0, Math.min(1, Number.isFinite(config.restitution) ? config.restitution : 0.1)));
        this.world.createCollider(desc, body);
        colliderCount += 1;
      } catch (err) {
        console.warn('[PhysicsRuntime] Skipped invalid convex hull collider:', err);
      }
    }

    if (colliderCount === 0) {
      try {
        if (body && (body as any).raw) {
          this.world.removeRigidBody(body);
        }
      } catch (_) {}
      throw new Error('Physics collision artifact contains no valid convex collider.');
    }

    const debug = this.buildDebugObject(
      collision.scene,
      bodyPosition,
      bodyQuaternion,
    );
    debug.position.copy(bodyPosition);
    debug.quaternion.copy(bodyQuaternion);
    scene.add(debug);
    this.bodies.push({
      body,
      visual: sourceVisual,
      debug,
      initialPosition: bodyPosition.clone(),
      initialQuaternion: bodyQuaternion.clone(),
    });

    sourceVisual.userData.physicsRuntime = true;
    this.initialized = true;
    this.setDebugVisibility(false);
  }

  private buildDebugObject(
    source: THREE.Object3D,
    bodyPosition: THREE.Vector3,
    bodyQuaternion: THREE.Quaternion,
  ): THREE.Object3D {
    const group = new THREE.Group();
    const material = new THREE.LineBasicMaterial({
      color: 0xffcc00,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });
    const inverseBody = new THREE.Matrix4()
      .compose(bodyPosition, bodyQuaternion, new THREE.Vector3(1, 1, 1))
      .invert();

    source.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const wire = new THREE.LineSegments(
        new THREE.WireframeGeometry(child.geometry),
        material,
      );
      wire.applyMatrix4(inverseBody.clone().multiply(child.matrixWorld));
      group.add(wire);
    });
    return group;
  }

  /**
   * Lightweight viewport-only rigid-body smoke test for ordinary loaded meshes.
   * Uses an approximate bounds collider and never writes physics metadata.
   */
  async initQuickTest(
    scene: THREE.Scene,
    sourceVisual: THREE.Object3D,
    config: PhysicsRuntimeConfig,
  ): Promise<void> {
    this.dispose();

    const rapier = await import('@dimforge/rapier3d-compat');
    await rapier.init();
    this.rapier = rapier;

    this.scene = scene;
    this.sourceVisual = sourceVisual;

    const gravity = config.gravityEnabled ? { x: 0, y: -9.81, z: 0 } : { x: 0, y: 0, z: 0 };
    this.world = new rapier.World(gravity);

    sourceVisual.updateMatrixWorld(true);
    const sourceBox = new THREE.Box3().setFromObject(sourceVisual);
    const size = sourceBox.getSize(new THREE.Vector3());
    const center = sourceBox.getCenter(new THREE.Vector3());
    const bodyPosition = sourceVisual.getWorldPosition(new THREE.Vector3());
    const bodyQuaternion = sourceVisual.getWorldQuaternion(new THREE.Quaternion()).normalize();
    const localCenter = center.clone().sub(bodyPosition).applyQuaternion(bodyQuaternion.clone().invert());

    const floorSizeX = Number.isFinite(size.x) ? Math.max(5, size.x * 4) : 10;
    const floorSizeZ = Number.isFinite(size.z) ? Math.max(5, size.z * 4) : 10;
    const floorCenterX = Number.isFinite(center.x) ? center.x : 0;
    const floorCenterZ = Number.isFinite(center.z) ? center.z : 0;
    const floorY = Number.isFinite(sourceBox.min.y) ? sourceBox.min.y - 0.02 : -1;

    try {
      const floorDesc = rapier.ColliderDesc.cuboid(floorSizeX, 0.05, floorSizeZ);
      floorDesc.setTranslation(floorCenterX, floorY, floorCenterZ);
      this.floor = this.world.createCollider(floorDesc);
    } catch (err) {
      console.warn('[PhysicsRuntime] Failed to create quick test floor:', err);
    }

    const bodyDesc = config.bodyType === 'static'
      ? rapier.RigidBodyDesc.fixed()
      : config.bodyType === 'kinematic'
      ? rapier.RigidBodyDesc.kinematicPositionBased()
      : rapier.RigidBodyDesc.dynamic();

    bodyDesc
      .setTranslation(
        Number.isFinite(bodyPosition.x) ? bodyPosition.x : 0,
        Number.isFinite(bodyPosition.y) ? bodyPosition.y : 0,
        Number.isFinite(bodyPosition.z) ? bodyPosition.z : 0,
      )
      .setRotation({
        x: Number.isFinite(bodyQuaternion.x) ? bodyQuaternion.x : 0,
        y: Number.isFinite(bodyQuaternion.y) ? bodyQuaternion.y : 0,
        z: Number.isFinite(bodyQuaternion.z) ? bodyQuaternion.z : 0,
        w: Number.isFinite(bodyQuaternion.w) ? bodyQuaternion.w : 1,
      })
      .setLinearDamping(Math.max(0, Number.isFinite(config.linearDamping) ? config.linearDamping : 0.05))
      .setAngularDamping(Math.max(0, Number.isFinite(config.angularDamping) ? config.angularDamping : 0.05));

    if (config.bodyType !== 'static') {
      bodyDesc.setAdditionalMass(Math.max(0.01, Number.isFinite(config.massKg) ? config.massKg : 1));
    }

    const body = this.world.createRigidBody(bodyDesc);
    const halfX = Number.isFinite(size.x) ? Math.max(0.02, size.x * 0.5) : 0.5;
    const halfY = Number.isFinite(size.y) ? Math.max(0.02, size.y * 0.5) : 0.5;
    const halfZ = Number.isFinite(size.z) ? Math.max(0.02, size.z * 0.5) : 0.5;

    try {
      const collider = rapier.ColliderDesc.cuboid(halfX, halfY, halfZ);
      collider
        .setTranslation(
          Number.isFinite(localCenter.x) ? localCenter.x : 0,
          Number.isFinite(localCenter.y) ? localCenter.y : 0,
          Number.isFinite(localCenter.z) ? localCenter.z : 0,
        )
        .setDensity(0)
        .setFriction(Math.max(0, Math.min(2, Number.isFinite(config.friction) ? config.friction : 0.5)))
        .setRestitution(Math.max(0, Math.min(1, Number.isFinite(config.restitution) ? config.restitution : 0.1)));
      this.world.createCollider(collider, body);
    } catch (err) {
      console.warn('[PhysicsRuntime] Failed to create quick test cuboid collider:', err);
    }

    const debug = new THREE.Group();
    debug.add(new THREE.Box3Helper(sourceBox, 0xffcc00));
    scene.add(debug);

    this.bodies.push({
      body,
      visual: sourceVisual,
      debug,
      initialPosition: bodyPosition.clone(),
      initialQuaternion: bodyQuaternion.clone(),
    });

    sourceVisual.userData.physicsRuntime = true;
    this.initialized = true;
    this.setDebugVisibility(false);
  }

  setRunning(value: boolean): void {
    this.running = Boolean(value);
  }

  isRunning(): boolean {
    return this.running && this.isReady();
  }

  isReady(): boolean {
    return this.initialized && Boolean(this.world) && Boolean((this.world as any).raw);
  }

  setDebugVisibility(visible: boolean): void {
    this.collisionDebugVisible = visible;
    for (const body of this.bodies) body.debug.visible = visible;
  }

  reset(): void {
    this.accumulator = 0;
    for (const item of this.bodies) {
      try {
        if (item.body && (item.body as any).raw) {
          item.body.setTranslation(item.initialPosition, true);
          item.body.setRotation(item.initialQuaternion, true);
          item.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          item.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
      } catch (e) {
        // Silently swallow dangling pointer errors on reset
      }
      item.visual.position.copy(item.initialPosition);
      item.visual.quaternion.copy(item.initialQuaternion);
      item.debug.position.copy(item.initialPosition);
      item.debug.quaternion.copy(item.initialQuaternion);
    }
  }

  applyTest(test: 'drop' | 'bounce' | 'slide' | 'spin'): void {
    if (!this.bodies.length || !this.isReady()) return;
    try {
      this.reset();
      const item = this.bodies[0];
      if (item?.body && (item.body as any).raw) {
        if (test === 'bounce') item.body.setLinvel({ x: 0, y: 3, z: 0 }, true);
        if (test === 'slide') item.body.setLinvel({ x: 2, y: 0, z: 0 }, true);
        if (test === 'spin') item.body.setAngvel({ x: 0, y: 3, z: 0 }, true);
      }
      this.running = true;
    } catch (e) {
      console.warn('[PhysicsRuntime] applyTest error:', e);
    }
  }

  step(): void {
    if (!this.isReady()) return;
    try {
      this.world.step();
      this.sync();
    } catch (err) {
      console.warn('[PhysicsRuntime] Step error suppressed:', err);
      this.running = false;
    }
  }

  tick(deltaSeconds = this.fixedStep): void {
    if (!this.running || !this.isReady()) return;
    try {
      this.accumulator += Math.min(0.05, Math.max(0, deltaSeconds));
      while (this.accumulator >= this.fixedStep) {
        if (!this.isReady()) break;
        this.world.step();
        this.accumulator -= this.fixedStep;
      }
      this.sync();
    } catch (err) {
      console.warn('[PhysicsRuntime] Tick error suppressed:', err);
      this.running = false;
    }
  }

  private sync(): void {
    if (!this.isReady()) return;
    for (const item of this.bodies) {
      try {
        if (!item.body || !(item.body as any).raw) continue;
        const p = item.body.translation();
        const r = item.body.rotation();
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) {
          item.visual.position.set(p.x, p.y, p.z);
          item.debug.position.set(p.x, p.y, p.z);
        }
        if (r && Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.z) && Number.isFinite(r.w)) {
          item.visual.quaternion.set(r.x, r.y, r.z, r.w);
          item.debug.quaternion.copy(item.visual.quaternion);
        }
      } catch (err) {
        // Guard against dangling or deallocated Rapier body pointers
      }
    }
  }

  dispose(): void {
    this.running = false;
    this.accumulator = 0;
    this.initialized = false;

    for (const item of this.bodies) {
      try {
        item.debug.parent?.remove(item.debug);
        item.debug.traverse((obj) => {
          if (obj instanceof THREE.LineSegments) {
            obj.geometry.dispose();
            const material = obj.material;
            if (Array.isArray(material)) material.forEach((m) => m.dispose());
            else material.dispose();
          }
        });
      } catch (_) {}
    }
    this.bodies = [];

    const worldToFree = this.world;
    this.floor = null;
    this.world = null;
    this.rapier = null;
    this.scene = null;
    this.sourceVisual = null;

    if (worldToFree) {
      try {
        if (typeof worldToFree.free === 'function') {
          worldToFree.free();
        }
      } catch (err) {
        // Silently swallow any WASM / Rust double-free or null pointer panic
        console.warn('[PhysicsRuntime] World free error suppressed:', err);
      }
    }
  }
}
