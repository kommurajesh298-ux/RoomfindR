const CHIP_BASE_CLASS = "rf-chip";

export const layoutStyles = {
  page: "rf-page",
  shell: "rf-shell",
  section: "rf-section",
  toolbar: "rf-toolbar",
  toolbarStack: "rf-toolbar-stack",
  hero: "rf-hero-panel",
  navSurface: "rf-nav-surface",
  mobileNav: "rf-mobile-nav",
  table: "rf-table",
  emptyState: "rf-empty-state",
  chip: CHIP_BASE_CLASS,
  chipActive: `${CHIP_BASE_CLASS} rf-chip-active`,
} as const;
