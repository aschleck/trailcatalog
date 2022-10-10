import * as corgi from 'js/corgi';
import { UnboundEvents } from 'js/corgi/binder';

import { FabricIcon, FabricIconName } from './fabric';

export function OutlinedInput({borderColor, className, icon, placeholder, ...props}: {
  borderColor?: string,
  className?: string,
  icon?: FabricIconName,
  inset?: corgi.VElementOrPrimitive,
  placeholder?: string,
} & corgi.InputProperties) {
  return <>
    <Input
        className={
            'border-[1px] rounded focus-within:border-current'
                + (className ? ` ${className}` : '')}
        icon={icon}
        placeholder={placeholder}
        {...props}
    />
  </>;
}

function Input({className, icon, inset, placeholder, unboundEvents, value, ...props}: {
  className?: string,
  icon?: FabricIconName,
  inset?: corgi.VElementOrPrimitive,
  placeholder?: string,
  unboundEvents?: UnboundEvents;
  value?: string;
} & corgi.InputProperties) {
  return <>
    <label
        className={
            'flex font-input gap-3 items-center px-3 py-2'
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
