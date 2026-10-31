import physicsDefaults from '@/constants/physicsDefaults.json';
import type { PhysicsSettings } from '../types';

export const DEFAULT_PHYSICS_SETTINGS: PhysicsSettings = {
  bodyType: physicsDefaults.defaults.body_type as PhysicsSettings['bodyType'],
  massMode: physicsDefaults.defaults.mass_mode as PhysicsSettings['massMode'],
  massKg: physicsDefaults.defaults.mass_kg,
  densityMode: physicsDefaults.defaults.density_mode as PhysicsSettings['densityMode'],
  densityKgM3: physicsDefaults.defaults.density_kg_m3,
  friction: physicsDefaults.defaults.friction,
  restitution: physicsDefaults.defaults.restitution,
  linearDamping: physicsDefaults.defaults.linear_damping,
  angularDamping: physicsDefaults.defaults.angular_damping,
  gravityEnabled: physicsDefaults.defaults.gravity_enabled,
  collisionQuality: physicsDefaults.default_collision_quality as PhysicsSettings['collisionQuality'],
  deformation: 'off',
};

export const PHYSICS_LIMITS = {
  massKg: physicsDefaults.limits.mass_kg,
  densityKgM3: physicsDefaults.limits.density_kg_m3,
} as const;
