/** Public prices shown on the landing page. Billing itself is handled by the checkout provider. */
export const OFFERS = {
  supporter: { price: "9,99 €", period: "/ year", detail: "or 3 € / month" },
  founder: { price: "59 €", period: "once", detail: "Lifetime access, 20 seats in total" },
} as const;
