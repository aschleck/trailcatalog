import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { InputOtherProperties } from 'external/dev_april_corgi+/js/corgi/elements';

import { Input as EmuInput } from 'external/dev_april_corgi+/js/emu/input';

import { FluentIcon, FluentIconName } from './fluent';

type InputProps = {
  className?: string,
  dense?: boolean,
  forceValue?: boolean,
  icon?: FluentIconName,
  inset?: corgi.VElementOrPrimitive,
  placeholder?: string,
  ref?: string,
} & InputOtherProperties;

export function OutlinedInput({className, ...props}: {
  className?: string,
} & InputProps) {
  return <>
    <Input
        className={
            '[&_input]:outline-none border border-tc-gray-400 rounded focus-within:border-current'
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
        icon={icon ? <FluentIcon name={icon} /> : <></>}
        {...props}
    />
  </>;
}
