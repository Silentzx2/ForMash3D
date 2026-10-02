import React from 'react';

interface IconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
  size?: number | string;
}

/**
 * Standard Sculpt Brush: Curved displacement chisel / fine point sculpting tip.
 */
export const StandardBrushIcon: React.FC<IconProps> = ({ className = 'w-4 h-4', size, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    className={className}
    {...props}
  >
    <path d="M19.5 4.5l-3.2 3.2m0 0l-8.5 8.5c-.7.7-1.1 1.6-1.2 2.6l-.3 1.8 1.8-.3c1-.1 1.9-.5 2.6-1.2l8.5-8.5-3.2-3.2z" fill="currentColor" fillOpacity="0.12" />
    <path d="M14 6l4 4" />
    <path d="M4 20l2.5-.5" />
    <path d="M18 2l4 4-2 2-4-4 2-2z" fill="currentColor" fillOpacity="0.3" />
    <path d="M8 12l4 4" strokeDasharray="1 2" />
  </svg>
);

/**
 * Clay Strips Brush: Wire loop / ribbon clay carving tool.
 */
export const ClayBrushIcon: React.FC<IconProps> = ({ className = 'w-4 h-4', size, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    className={className}
    {...props}
  >
    <rect x="3" y="15" width="18" height="5" rx="1.5" fill="currentColor" fillOpacity="0.2" />
    <rect x="5" y="9" width="14" height="4" rx="1" fill="currentColor" fillOpacity="0.35" />
    <rect x="7" y="4" width="10" height="3" rx="0.8" fill="currentColor" fillOpacity="0.5" />
    <path d="M3 17.5h18" strokeWidth="1.2" strokeOpacity="0.5" />
    <path d="M5 11h14" strokeWidth="1.2" strokeOpacity="0.5" />
  </svg>
);

/**
 * Inflate Brush: Spherical volume expansion with outward radial vectors.
 */
export const InflateBrushIcon: React.FC<IconProps> = ({ className = 'w-4 h-4', size, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    className={className}
    {...props}
  >
    <circle cx="12" cy="12" r="6" fill="currentColor" fillOpacity="0.18" />
    <path d="M12 2v3m0 14v3" />
    <path d="M2 12h3m14 0h3" />
    <path d="M4.93 4.93l2.12 2.12m9.9 9.9l2.12 2.12" />
    <path d="M19.07 4.93l-2.12 2.12m-9.9 9.9l-2.12 2.12" />
    <circle cx="12" cy="12" r="2.5" fill="currentColor" />
  </svg>
);

/**
 * Smooth Brush: Soft blending fan / multi-bristle polishing pad.
 */
export const SmoothBrushIcon: React.FC<IconProps> = ({ className = 'w-4 h-4', size, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    className={className}
    {...props}
  >
    <path d="M3 18c3-4 6-5 9-5s6 1 9 5" strokeWidth="2" />
    <path d="M5 13c2.5-3 5-4 7-4s4.5 1 7 4" opacity="0.75" />
    <path d="M7 8c2-2 3.5-3 5-3s3 1 5 3" opacity="0.5" />
    <path d="M12 2v20" strokeDasharray="2 3" strokeWidth="1.2" opacity="0.6" />
    <circle cx="12" cy="13" r="1.5" fill="currentColor" />
  </svg>
);

/**
 * Flatten Brush: Planar scraper blade / leveling trowel.
 */
export const FlattenBrushIcon: React.FC<IconProps> = ({ className = 'w-4 h-4', size, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    className={className}
    {...props}
  >
    <path d="M3 19h18" strokeWidth="2.5" />
    <path d="M6 15l4-8h4l4 8" fill="currentColor" fillOpacity="0.15" />
    <path d="M12 3v4" strokeWidth="2" />
    <path d="M10 7h4" strokeWidth="2" />
    <path d="M7 19l2-4h6l2 4" fill="currentColor" fillOpacity="0.3" />
  </svg>
);

/**
 * Pinch Brush: Dual opposing precision wedges pulling surface together into a crease.
 */
export const PinchBrushIcon: React.FC<IconProps> = ({ className = 'w-4 h-4', size, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    className={className}
    {...props}
  >
    <path d="M5 12h5m-2-3l3 3-3 3" />
    <path d="M19 12h-5m2-3l-3 3 3 3" />
    <line x1="12" y1="4" x2="12" y2="20" strokeWidth="2" strokeDasharray="1 2" stroke="currentColor" />
    <circle cx="12" cy="12" r="2" fill="currentColor" />
  </svg>
);

/**
 * Grab / Elastic Move Brush: Vector arrow pulling a node with elastic tensile curves.
 */
export const GrabBrushIcon: React.FC<IconProps> = ({ className = 'w-4 h-4', size, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    className={className}
    {...props}
  >
    <path d="M12 2l4 4h-3v7h-2V6H8l4-4z" fill="currentColor" fillOpacity="0.25" />
    <path d="M4 17c3-3 5-4 8-4s5 1 8 4" strokeWidth="1.8" />
    <circle cx="12" cy="13" r="2.5" fill="currentColor" />
    <path d="M6 21c2.5-1.5 4-2 6-2s3.5.5 6 2" opacity="0.5" />
  </svg>
);

/**
 * Texture Paint Brush: Artist round-ferrule paintbrush with dripping pigment.
 */
export const PaintBrushToolIcon: React.FC<IconProps> = ({ className = 'w-4 h-4', size, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    className={className}
    {...props}
  >
    <path d="M18.37 2.63c.98-.98 2.56-.98 3.54 0 .98.98.98 2.56 0 3.54l-7.79 7.79-3.54-3.54 7.79-7.79z" fill="currentColor" fillOpacity="0.25" />
    <path d="M10.58 10.42l-2.12 2.12c-.59.59-.96 1.37-1.04 2.21l-.42 4.25 4.25-.42c.84-.08 1.62-.45 2.21-1.04l2.12-2.12-5-5z" fill="currentColor" fillOpacity="0.12" />
    <path d="M3 21c1.5-1.5 2-3 2-4.5" stroke="currentColor" strokeWidth="2" />
    <circle cx="4" cy="20" r="1.5" fill="currentColor" />
  </svg>
);

/**
 * Airbrush / Spray Tool: Precision conical aerosol spray.
 */
export const AirbrushIcon: React.FC<IconProps> = ({ className = 'w-4 h-4', size, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    className={className}
    {...props}
  >
    <path d="M3 13l4-4 2 2-4 4H3v-2z" fill="currentColor" fillOpacity="0.25" />
    <path d="M9 11l8-8 3 3-8 8" />
    <path d="M14 6l3 3" />
    <circle cx="18" cy="18" r="1" fill="currentColor" />
    <circle cx="21" cy="15" r="1" fill="currentColor" />
    <circle cx="15" cy="21" r="1" fill="currentColor" />
    <circle cx="21" cy="21" r="1.5" fill="currentColor" opacity="0.6" />
    <circle cx="16" cy="15" r="0.75" fill="currentColor" />
  </svg>
);

/**
 * Eraser Tool: Angled beveled rubber block.
 */
export const EraserToolIcon: React.FC<IconProps> = ({ className = 'w-4 h-4', size, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    className={className}
    {...props}
  >
    <path d="M19.5 13.5L12 21H6l-3.5-3.5a2.12 2.12 0 0 1 0-3L13 4l6.5 6.5a2.12 2.12 0 0 1 0 3z" fill="currentColor" fillOpacity="0.15" />
    <path d="M8.5 8.5l7 7" strokeOpacity="0.6" />
    <path d="M18 21h4" strokeWidth="2.5" />
  </svg>
);

/**
 * Eyedropper / Color Sampler Tool: Precision pipette with droplet.
 */
export const EyedropperToolIcon: React.FC<IconProps> = ({ className = 'w-4 h-4', size, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    className={className}
    {...props}
  >
    <path d="M19 3l2 2-2 2-1-1-6.5 6.5c-.3.3-.5.7-.5 1.1V16h2.4c.4 0 .8-.2 1.1-.5L21 9l-1-1 2-2" />
    <path d="M11 14l-8 8H2v-1l8-8" fill="currentColor" fillOpacity="0.25" />
    <circle cx="4" cy="20" r="1.5" fill="currentColor" />
  </svg>
);

/**
 * Flood Fill Bucket: Pouring paint bucket with flowing droplet.
 */
export const PaintBucketIcon: React.FC<IconProps> = ({ className = 'w-4 h-4', size, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    className={className}
    {...props}
  >
    <path d="M19 11l-8-8-8.5 8.5a2.12 2.12 0 0 0 0 3l5.5 5.5a2.12 2.12 0 0 0 3 0L19 11z" fill="currentColor" fillOpacity="0.18" />
    <path d="M5 2l5 5" />
    <path d="M2 13l7.5 7.5" />
    <path d="M22 19c0 1.66-1.34 3-3 3s-3-1.34-3-3c0-2 3-5 3-5s3 3 3 5z" fill="currentColor" />
  </svg>
);
