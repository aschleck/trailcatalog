import * as corgi from 'js/corgi';

import { FabricIcon, FabricIconName } from './fabric';

export function FlatButton({className, dense, icon, label, ...props}: {
  className?: string,
  dense?: boolean,
  icon: FabricIconName,
  label?: string,
} & corgi.Properties<HTMLButtonElement>) {
  return <>
    <Button className={className} dense={dense} icon={icon} label={label} {...props} />
  </>;
}

export function OutlinedButton({className, dense, icon, label, ...props}: {
  className?: string,
  dense?: boolean,
  icon: FabricIconName,
  label?: string,
} & corgi.Properties<HTMLButtonElement>) {
  return <>
    <Button
        className={'border-[1px] border-black ' + (className ? ` ${className}` : '')}
        dense={dense}
        icon={icon}
        label={label}
        {...props}
    />
  </>;
}

function Button({className, dense, icon, label, ...props}: {
  className?: string,
  dense?: boolean,
  icon: FabricIconName,
  label?: string,
} & corgi.Properties<HTMLButtonElement>) {
  return <>
    <button
        className={
          'inline-block leading-none rounded space-x-2 '
              + (!dense ? 'p-1 ' : 'p-0.5')
              + (className ? ` ${className}` : '')
        }
        {...props}
    >
      <FabricIcon name={icon} className="align-bottom" />
      {label ? <span>{label}</span> : ''}
    </button>
  </>;
}

