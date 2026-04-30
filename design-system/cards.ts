const CARD_BASE_CLASS = "rf-card";
const CARD_ACCENT_BASE_CLASS = "rf-stat-card__accent";

export const cardStyles = {
  base: CARD_BASE_CLASS,
  interactive: `${CARD_BASE_CLASS} rf-card-interactive`,
  panel: "rf-panel",
  stat: "rf-stat-card",
  soft: `${CARD_BASE_CLASS} rf-card-soft`,
  table: "rf-table-card",
} as const;

export const cardAccentStyles = {
  action: `${CARD_ACCENT_BASE_CLASS} rf-stat-card__accent--action`,
  success: `${CARD_ACCENT_BASE_CLASS} rf-stat-card__accent--success`,
  info: `${CARD_ACCENT_BASE_CLASS} rf-stat-card__accent--info`,
  neutral: `${CARD_ACCENT_BASE_CLASS} rf-stat-card__accent--neutral`,
  warning: `${CARD_ACCENT_BASE_CLASS} rf-stat-card__accent--warning`,
} as const;
