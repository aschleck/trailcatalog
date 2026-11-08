import { maybeMemoized } from 'external/dev_april_corgi+/js/common/memoized';
import { getLanguage } from 'external/dev_april_corgi+/js/server/ssr_aware';

import { readCookie, writeCookie } from 'js/cookies/cookies';

export type UnitSystem = 'imperial'|'metric';

const UNIT_SYSTEM_COOKIE = 'unit_system';

function calculateUnitSystem(): UnitSystem {
  const requested = readCookie(UNIT_SYSTEM_COOKIE);
  if (requested === 'imperial' || requested === 'metric') {
    return requested;
  }

  const imperial = getLanguage() === 'en-LR' || getLanguage() === 'en-US' || getLanguage() === 'my';
  return imperial ? 'imperial' : 'metric';
}

const chosenUnitSystem = maybeMemoized(calculateUnitSystem);

export function getUnitSystem(): UnitSystem {
  return chosenUnitSystem.value;
}

export function setUnitSystem(system: UnitSystem) {
  chosenUnitSystem.value = system;
  writeCookie(UNIT_SYSTEM_COOKIE, system);
}

export function celsiusToFahrenheit(celsius: number): number {
  return 1.8 * celsius + 32;
}

// The international foot
export const METERS_PER_FOOT = 0.3048;
export const METERS_PER_MILE = 5280 * METERS_PER_FOOT;

export function metersToFeet(meters: number): number {
  return meters / METERS_PER_FOOT;
}

export function metersToMiles(meters: number): number {
  return meters / METERS_PER_MILE;
}

const integerFormatter = new Intl.NumberFormat(undefined, {
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

export function formatArea(meters2: number): FormattedScalar {
  const useImperial = shouldUseImperial();
  return {
    value:
        integerFormatter.format(
            useImperial ? metersToMiles(metersToMiles(meters2)) : meters2 / 1000_000),
    unit: useImperial ? 'mi²' : 'km²',
  };
}

export function formatCount(count: number): string {
  return integerFormatter.format(count);
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
    value: integerFormatter.format(useImperial ? metersToFeet(meters) : meters),
    unit: useImperial ? 'ft' : 'm',
  };
}

export function formatTemperature(celsius: number): FormattedScalar {
  const useImperial = shouldUseImperial();
  return {
    value: integerFormatter.format(useImperial ? celsiusToFahrenheit(celsius) : celsius),
    unit: useImperial ? '°F' : '°C',
  };
}

export function shouldUseImperial(): boolean {
  return getUnitSystem() === 'imperial';
}

