const BADGE_BASE_CLASS = "rf-badge";

export const badgeStyles = {
  base: BADGE_BASE_CLASS,
  success: `${BADGE_BASE_CLASS} rf-badge-success`,
  warning: `${BADGE_BASE_CLASS} rf-badge-warning`,
  error: `${BADGE_BASE_CLASS} rf-badge-error`,
  info: `${BADGE_BASE_CLASS} rf-badge-info`,
  neutral: `${BADGE_BASE_CLASS} rf-badge-neutral`,
} as const;
