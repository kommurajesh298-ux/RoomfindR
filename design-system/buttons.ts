const BUTTON_BASE_CLASS = "rf-btn";

export const buttonStyles = {
  base: BUTTON_BASE_CLASS,
  primary: `${BUTTON_BASE_CLASS} rf-btn-primary`,
  secondary: `${BUTTON_BASE_CLASS} rf-btn-secondary`,
  danger: `${BUTTON_BASE_CLASS} rf-btn-danger`,
  icon: `${BUTTON_BASE_CLASS} rf-btn-icon`,
  ghost: `${BUTTON_BASE_CLASS} rf-btn-ghost`,
} as const;

export type ButtonVariant = keyof typeof buttonStyles;
