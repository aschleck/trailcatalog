import * as corgi from 'js/corgi';

import './fabric-icons-inline.css';

// Fabric's official definitions are missing icons, so we just do it ourselves.
const FABRIC_ICON_CODES = [
  'BulletedList',
  'Info',
  'Info12',
  'List',
  'ZoomToFit',
] as const;

/**
 * A copyable list for use in the https://uifabricicons.azurewebsites.net/ tool:
E8FD
E946
E55A
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

