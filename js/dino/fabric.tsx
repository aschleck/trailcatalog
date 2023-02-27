import * as corgi from 'js/corgi';

import './fabric-icons-inline.css';

// Fabric's official definitions are missing icons, so we just do it ourselves.
const FABRIC_ICON_CODES = [
  'BlowingSnow',
  'CharticulatorLine',
  'Checkbox',
  'CheckboxCompositeReversed',
  'ChevronDownMed',
  'ChevronUpMed',
  'ChromeBack',
  'ChromeClose',
  'Cloudy',
  'CollapseMenu',
  'Fog',
  'Feedback',
  'Globe',
  'LightSnow',
  'Location',
  'Market',
  'MarketDown',
  'MostySunnyDay',
  'Nav2DMapView',
  'PartlySunnyDay',
  'PartlySunnyFlurriesDay',
  'PartlySunnyShowersDay',
  'PartlySunnyTStormsDay',
  'Rain',
  'RainSnow',
  'ScaleVolume',
  'Search',
  'Snow',
  'SortDown',
  'SortUp',
  'Sunny',
  'Thunderstorms',
  'ZoomToFit',
] as const;

/**
 * A copyable list for use in the https://uifabricicons.azurewebsites.net/ tool:
EA02
E639
E739
E73D
E972
E971
E830
E8BB
E9BF
EF66
E9CB
ED15
E774
EA02
E81D
EAFC
EF42
E468
E800
E469
E472
E46E
E470
E9C4
E9C7
F18C
E721
E9C8
EE69
EE68
E9BD
E9C6
F649
 */

export type FabricIconName = (typeof FABRIC_ICON_CODES)[keyof typeof FABRIC_ICON_CODES];

export function FabricIcon({
  name,
  className,
  ...props
}: {
  name: FabricIconName,
  className?: string,
} & corgi.Properties) {
  return <>
    <i
        className={`ms-Icon ms-Icon--${String(name)} ${className ? className : ''}`}
        {...props}
    />
  </>;
}

