import * as corgi from 'js/corgi';
import { UnboundEvents } from 'js/corgi/binder';

import { FabricIcon, FabricIconName } from './fabric';
import { InputController, State } from './input_controller';

type InputProps = {
  className?: string,
  dense?: boolean,
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

function Input(
    {className, dense, icon, inset, placeholder, ref, value, ...props}: InputProps,
    state: State|undefined,
    updateState: (newState: State) => void) {
  if (!state) {
    state = {managed: true};
  }

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
          js={corgi.bind({
            controller: InputController,
            events: {
              'keyup': 'keyPressed',
            },
            ref,
            state: [state, updateState],
          })}
          className="bg-transparent grow outline-none placeholder-current"
          placeholder={placeholder ?? ''}
          value={state.managed ? value : undefined}
      />
      {inset ?? ''}
    </label>
  </>;
}
