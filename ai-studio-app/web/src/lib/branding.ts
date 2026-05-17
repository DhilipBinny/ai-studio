import { BRAND_NAME, BRAND_COMPANY, BRAND_HEX } from "@ais-app/types";

export const BRAND = {
  name: BRAND_NAME,
  shortName: "Kairo Studio",
  company: BRAND_COMPANY,
  logoAlt: "Kairo",

  logo: "/branding/kairo-logo.png",
  icon: "/branding/kairo-icon.png",

  emailPlaceholder: "you@example.com",
  copyright: (year: number) => `© ${year} ${BRAND_COMPANY}. All rights reserved.`,

  hex: BRAND_HEX,
} as const;
