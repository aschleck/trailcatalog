import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';
import { FluentIconName } from 'js/dino/fluent';

export const WEATHER_LABEL_TO_ICON: {[k: string]: FluentIconName} = {
  'Unknown': 'CheckboxUnchecked',
  'Clear': 'WeatherSunny',
  'Partly cloudy': 'WeatherPartlyCloudyDay',
  'Cloudy': 'WeatherCloudy',
  'Fog': 'WeatherFog',
  'Rain': 'WeatherRain',
  'Snow': 'WeatherSnow',
  'Rain showers': 'WeatherRain',
  'Snow showers': 'WeatherSnowShowerDay',
  'Thunderstorms': 'WeatherThunderstorm',
} as const;

export function formatWeatherCode(code: number): {
  icon: FluentIconName,
  label: keyof typeof WEATHER_LABEL_TO_ICON,
} {
  let label;
  if (0 <= code && code <= 1) {
    label = 'Clear';
  } else if (code === 2) {
    label = 'Partly cloudy';
  } else if (code === 3) {
    label = 'Cloudy';
  } else if (45 <= code && code <= 48) {
    label = 'Fog';
  } else if (51 <= code && code <= 65) {
    label = 'Rain';
  } else if (71 <= code && code <= 77) {
    label = 'Snow';
  } else if (80 <= code && code <= 82) {
    label = 'Rain showers';
  } else if (85 <= code && code <= 86) {
    label = 'Snow showers';
  } else if (95 <= code && code <= 99) {
    label = 'Thunderstorms';
  } else {
    label = 'Unknown';
  }
  return {
    icon: WEATHER_LABEL_TO_ICON[label],
    label,
  };
}
