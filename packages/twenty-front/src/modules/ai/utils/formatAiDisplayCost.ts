import { formatNumber } from '~/utils/format/formatNumber';

// Display credits arrive from the API as "1000 credits = $1" units
// (the server divides internal micro-credits by 1000 before exposing them).
// When workspace billing is enabled, users think in credits (that's the unit
// they purchased). When billing is off, fall back to raw dollars.

type FormatAiDisplayCostOptions = {
  isBillingEnabled: boolean;
};

export const formatAiDisplayCost = (
  displayCredits: number,
  { isBillingEnabled }: FormatAiDisplayCostOptions,
): string => {
  if (isBillingEnabled) {
    return `${formatNumber(displayCredits, { decimals: 1 })} credits`;
  }

  const dollars = displayCredits / 1000;

  return `$${formatNumber(dollars, { decimals: 2 })}`;
};
