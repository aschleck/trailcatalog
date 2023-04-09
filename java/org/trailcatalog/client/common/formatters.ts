import { getUnitSystem } from 'js/server/ssr_aware';

import { celsiusToFahrenheit, metersToFeet, metersToMiles } from './math';

const areaFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
  style: 'decimal',
});

const countFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
  style: 'decimal',
});

const distanceFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
  style: 'decimal',
});

const heightFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
  style: 'decimal',
});

const temperatureFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
  style: 'decimal',
});

interface FormattedScalar {
  value: string;
  unit: string;
}

export function formatArea(meters2: number): FormattedScalar {
  const useImperial = shouldUseImperial();
  return {
    value:
        areaFormatter.format(
            useImperial ? metersToMiles(metersToMiles(meters2)) : meters2 / 1000_000),
    unit: useImperial ? 'mi²' : 'km²',
  };
}

export function formatCount(count: number): string {
  return countFormatter.format(count);
}

export function formatDistance(meters: number): FormattedScalar {
  const useImperial = shouldUseImperial();
  return {
    value: distanceFormatter.format(useImperial ? metersToMiles(meters) : meters / 1000),
    unit: useImperial ? 'mi' : 'km',
  };
}

export function formatHeight(meters: number): FormattedScalar {
  const useImperial = shouldUseImperial();
  return {
    value: heightFormatter.format(useImperial ? metersToFeet(meters) : meters),
    unit: useImperial ? 'ft' : 'm',
  };
}

export function formatTemperature(celsius: number): FormattedScalar {
  const useImperial = shouldUseImperial();
  return {
    value: temperatureFormatter.format(useImperial ? celsiusToFahrenheit(celsius) : celsius),
    unit: useImperial ? '°F' : '°C',
  };
}

export function shouldUseImperial(): boolean {
  return getUnitSystem() === 'imperial';
}

