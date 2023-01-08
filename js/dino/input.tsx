import * as corgi from 'js/corgi';
import { UnboundEvents } from 'js/corgi/binder';

import { FabricIcon, FabricIconName } from './fabric';

type InputProps = {
  className?: string,
  dense?: boolean,
  icon?: FabricIconName,
  inset?: corgi.VElementOrPrimitive,
  placeholder?: string,
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

function Input(
    {className, dense, icon, inset, placeholder, unboundEvents, value, ...props}: InputProps) {
  return <>
    <label
        className={
            'flex font-input gap-3 items-center'
                + (dense !== true ? ' px-3 py-1' : '')
                + (className ? ` ${className} ` : '')
        }
        {...props}
    >
      {icon ? <FabricIcon name={icon} /> : <></>}
      <input
          className="bg-transparent grow outline-none placeholder-current"
          placeholder={placeholder}
          unboundEvents={unboundEvents}
          value={value}
      />
      {inset ?? ''}
    </label>
  </>;
}
