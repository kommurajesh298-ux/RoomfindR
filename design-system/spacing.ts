export const spacing = {
  base: 4,
  x1: "4px",
  x2: "8px",
  x3: "12px",
  x4: "16px",
  x5: "20px",
  x6: "24px",
  x8: "32px",
  x10: "40px",
} as const;

export const radius = {
  card: "16px",
  button: "10px",
  input: "12px",
  panel: "24px",
  pill: "999px",
} as const;

export const shadows = {
  soft: "0 18px 44px rgba(15, 23, 42, 0.08)",
  medium: "0 24px 54px rgba(15, 23, 42, 0.12)",
  action: "0 16px 32px rgba(249, 115, 22, 0.24)",
  success: "0 16px 32px rgba(59, 130, 246, 0.18)",
} as const;

export const cssSpacingVars = {
  "--rf-radius-card": radius.card,
  "--rf-radius-button": radius.button,
  "--rf-radius-input": radius.input,
  "--rf-radius-panel": radius.panel,
  "--rf-radius-pill": radius.pill,
  "--rf-shadow-soft": shadows.soft,
  "--rf-shadow-medium": shadows.medium,
  "--rf-shadow-action": shadows.action,
  "--rf-shadow-success": shadows.success,
} as const;

export type RoomFindRSpacing = typeof spacing;
export type RoomFindRRadius = typeof radius;
export type RoomFindRShadows = typeof shadows;

