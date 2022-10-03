import * as corgi from 'js/corgi';

import './fabric-icons-inline.css';

// Fabric's official definitions are missing icons, so we just do it ourselves.
const FABRIC_ICON_CODES = [
  'BulletedList',
  'CalculatorMultiply',
  'Checkbox',
  'CheckboxComposite',
  'ChevronRight',
  'Info',
  'Info12',
  'List',
  'Search',
  'ZoomToFit',
] as const;

/**
 * A copyable list for use in the https://uifabricicons.azurewebsites.net/ tool:
E8FD
E947
E739
E73A
E946
E55A
E721
E76C
EA37
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
} & corgi.Properties<HTMLElement>) {
  return <>
    <i
        className={`ms-Icon ms-Icon--${String(name)} ${className ? className : ''}`}
        {...props}
    />
  </>;
}

