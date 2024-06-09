import * as corgi from 'external/dev_april_corgi~/js/corgi';

import { Button as EmuButton } from 'external/dev_april_corgi~/js/emu/button';
import { FabricIcon, FabricIconName } from './fabric';

type ButtonProps = {
  ariaLabel?: string,
  className?: string,
  dense?: boolean,
  icon?: FabricIconName,
  label?: string,
} & corgi.Properties;

export function FlatButton({className, ...props}: ButtonProps) {
  return <>
    <Button
        className={className}
        {...props} />
  </>;
}

export function OutlinedButton({className, ...props}: ButtonProps) {
  return <>
    <Button
        className={
            'border-[1px] border-tc-gray-400'
                + (className ? ` ${className}` : '')
        }
        {...props}
    />
  </>;
}

export function Button({className, dense, icon, label, ...props}: ButtonProps) {
  return <>
    <EmuButton
        className={
          'inline-block leading-none rounded select-none space-x-2'
              + ' active:bg-tc-gray-400'
              + (!dense ? ' p-2 ' : '-m-1 p-1')
              + (className ? ` ${className}` : '')
        }
    >
      {icon ? <><FabricIcon name={icon} className="align-bottom" />{' '}</> : ''}
      {label ? <span>{label}</span> : ''}
    </EmuButton>
  </>;
}

