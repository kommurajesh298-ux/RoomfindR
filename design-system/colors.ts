export const colors = {
  brand: {
    primaryGreen: "#3B82F6",
    darkGreen: "#2563EB",
    lightGreen: "#DBEAFE",
  },
  action: {
    primaryOrange: "#F97316",
    hoverOrange: "#EA580C",
    lightOrange: "#FED7AA",
  },
  neutral: {
    background: "#FFFFFF",
    pageBackground: "#F9FAFB",
    borderGrey: "#E5E7EB",
    lightGrey: "#F3F4F6",
    darkGrey: "#374151",
  },
  text: {
    primary: "#111827",
    secondary: "#6B7280",
    muted: "#9CA3AF",
  },
  status: {
    success: "#3B82F6",
    warning: "#F59E0B",
    error: "#EF4444",
    info: "#3B82F6",
  },
  surface: {
    success: "#EFF6FF",
    warning: "#FFF7ED",
    error: "#FEF2F2",
    info: "#EFF6FF",
  },
  gradients: {
    sunrise: "linear-gradient(135deg, #FED7AA 0%, #FFFFFF 42%, #DBEAFE 100%)",
    action: "linear-gradient(135deg, #F97316 0%, #EA580C 100%)",
    brand: "linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)",
    softGlow:
      "radial-gradient(circle at top left, rgba(249, 115, 22, 0.16), transparent 32%), radial-gradient(circle at bottom right, rgba(59, 130, 246, 0.14), transparent 36%)",
  },
} as const;

export const cssColorVars = {
  "--rf-color-primary-green": colors.brand.primaryGreen,
  "--rf-color-primary-green-dark": colors.brand.darkGreen,
  "--rf-color-primary-green-soft": colors.brand.lightGreen,
  "--rf-color-action": colors.action.primaryOrange,
  "--rf-color-action-hover": colors.action.hoverOrange,
  "--rf-color-action-soft": colors.action.lightOrange,
  "--rf-color-background": colors.neutral.background,
  "--rf-color-page": colors.neutral.pageBackground,
  "--rf-color-border": colors.neutral.borderGrey,
  "--rf-color-surface-muted": colors.neutral.lightGrey,
  "--rf-color-surface-strong": colors.neutral.darkGrey,
  "--rf-color-text": colors.text.primary,
  "--rf-color-text-secondary": colors.text.secondary,
  "--rf-color-text-muted": colors.text.muted,
  "--rf-color-success": colors.status.success,
  "--rf-color-warning": colors.status.warning,
  "--rf-color-error": colors.status.error,
  "--rf-color-info": colors.status.info,
} as const;

export type RoomFindRColors = typeof colors;


