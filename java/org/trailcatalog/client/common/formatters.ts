import { metersToMiles } from './math';
import { getLanguage } from './ssr_aware';

const countFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
  style: 'decimal',
});

const distanceFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
  style: 'decimal',
});

interface FormattedScalar {
  value: string;
  unit: string;
}

export function formatCount(count: number): string {
  return countFormatter.format(count);
}

export function formatDistance(meters: number): FormattedScalar {
  const useMiles =
      getLanguage() === 'en-LR' || getLanguage() === 'en-US' || getLanguage() === 'my';

  return {
    value: distanceFormatter.format(useMiles ? metersToMiles(meters) : meters / 1000),
    unit: useMiles ? 'miles' : 'km',
  };
}
