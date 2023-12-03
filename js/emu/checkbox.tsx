import * as corgi from 'js/corgi';

import { CheckboxController, State } from './checkbox_controller';

type CheckboxProps = {
  ariaLabel?: string;
  checked?: boolean;
  children?: corgi.VElementOrPrimitive[];
  className?: string;
} & corgi.Properties;

export function Checkbox(
    {ariaLabel, checked, children, className, ...props}: CheckboxProps,
    state: State|undefined,
    updateState: (newState: State) => void) {
  if (!state) {
    state = {
      checked: checked ?? false,
    };
  }

  return <>
    <label className={'inline-block' + (className ? ` ${className}` : '')} {...props}>
      <input
          js={corgi.bind({
            controller: CheckboxController,
            events: {
              'click': 'clicked',
              'keyup': 'keyPressed',
            },
            state: [state, updateState],
          })}
          ariaLabel={ariaLabel}
          checked={state.checked}
          type="checkbox"
      />
      {children}
    </label>
  </>;
}

