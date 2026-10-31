/**
 * Standardized motion & animation presets for ForMash 3D UI.
 * Consistent timing, easing, and spring physics across panels, drawers, modals, and tabs.
 * Universal format compatible with both framer-motion and motion/react.
 */

export const MOTION_FAST = {
  duration: 0.15,
  ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
};

export const MOTION_BASE = {
  duration: 0.2,
  ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
};

export const MOTION_SLOW = {
  duration: 0.3,
  ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
};

export const MOTION_SPRING = {
  type: 'spring' as const,
  stiffness: 300,
  damping: 30,
};

export const MOTION_SPRING_SNAPPY = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 25,
};
