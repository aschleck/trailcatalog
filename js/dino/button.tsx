import * as corgi from 'external/dev_april_corgi+/js/corgi';

import { Button as EmuButton } from 'external/dev_april_corgi+/js/emu/button';
import { FluentIcon, FluentIconName } from './fluent';

type ButtonProps = {
  ariaLabel?: string,
  className?: string,
  dense?: boolean,
  icon?: FluentIconName,
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

export function Button({ariaLabel, className, dense, icon, label, title}: ButtonProps) {
  return <>
    <EmuButton
        ariaLabel={ariaLabel}
        className={
          'inline-block leading-none rounded select-none space-x-2'
              + ' active:bg-tc-gray-400'
              + (!dense ? ' p-2 ' : '-m-1 p-1')
              + (className ? ` ${className}` : '')
        }
        title={title}
    >
      {icon ? <><FluentIcon name={icon} />{' '}</> : ''}
      {label ? <span>{label}</span> : ''}
    </EmuButton>
  </>;
}

