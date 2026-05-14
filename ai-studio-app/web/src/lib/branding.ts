import { BRAND_NAME, BRAND_COMPANY, BRAND_HEX } from "@ais-app/types";

export const BRAND = {
  name: BRAND_NAME,
  shortName: "AI Studio",
  company: BRAND_COMPANY,
  logoAlt: "Echol",

  logo: "/branding/echollogo.png",
  icon: "/branding/echol-icon.png",

  emailPlaceholder: "you@echoltech.com",
  copyright: (year: number) => `© ${year} ${BRAND_COMPANY}. All rights reserved.`,

  hex: BRAND_HEX,
} as const;
