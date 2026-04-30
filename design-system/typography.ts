const fontFamilySans =
  "'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const typeSizes = {
  pageTitle: "28px",
  sectionTitle: "22px",
  cardTitle: "18px",
  body: "16px",
  secondary: "14px",
  small: "12px",
} as const;

const typeWeights = {
  regular: 400,
  semibold: 600,
  bold: 700,
} as const;

export const typography = {
  fontFamily: {
    sans: fontFamilySans,
  },
  sizes: typeSizes,
  weights: typeWeights,
  classes: {
    pageTitle: `text-[${typeSizes.pageTitle}] font-bold tracking-[-0.03em] leading-[1.05]`,
    sectionTitle: `text-[${typeSizes.sectionTitle}] font-bold tracking-[-0.02em] leading-[1.12]`,
    cardTitle: `text-[${typeSizes.cardTitle}] font-semibold tracking-[-0.02em] leading-[1.2]`,
    body: `text-[${typeSizes.body}] font-normal leading-[1.55]`,
    secondary: `text-[${typeSizes.secondary}] font-normal leading-[1.5]`,
    small: `text-[${typeSizes.small}] font-medium leading-[1.4]`,
  },
} as const;

export type RoomFindRTypography = typeof typography;
