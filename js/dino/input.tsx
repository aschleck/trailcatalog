import * as corgi from 'external/dev_april_corgi~/js/corgi';

import { Input as EmuInput } from 'external/dev_april_corgi~/js/emu/input';

import { FabricIcon, FabricIconName } from './fabric';

type InputProps = {
  className?: string,
  dense?: boolean,
  forceValue?: boolean,
  icon?: FabricIconName,
  inset?: corgi.VElementOrPrimitive,
  placeholder?: string,
  ref?: string,
} & corgi.InputProperties;

export function OutlinedInput({className, ...props}: {
  className?: string,
} & InputProps) {
  return <>
    <Input
        className={
            'border border-tc-gray-400 rounded focus-within:border-current'
                + (className ? ` ${className}` : '')}
        {...props}
    />
  </>;
}

function Input({className, dense, icon, ...props}: InputProps) {
  return <>
    <EmuInput
        className={
          (dense !== true ? ' px-3 py-1' : '') + (className ? ` ${className} ` : '')
        }
        icon={icon ? <FabricIcon name={icon} /> : <></>}
        {...props}
    />
  </>;
}
