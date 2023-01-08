import * as corgi from 'js/corgi';

import { ButtonController, State } from './button_controller';
import { FabricIcon, FabricIconName } from './fabric';

type ButtonProps = {
  ariaLabel?: string,
  className?: string,
  dense?: boolean,
  icon?: FabricIconName,
  label?: string,
} & corgi.Properties<HTMLButtonElement>;

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

export function Button(
    {ariaLabel, className, dense, icon, label, ...props}: ButtonProps,
    state: State|undefined,
    updateState: (newState: State) => void) {
  if (!state) {
    state = {};
  }

  return <>
    <button
        js={corgi.bind({
          controller: ButtonController,
          events: {
            'click': 'clicked',
            'keyup': 'keyPressed',
          },
          state: [state, updateState],
        })}
        className={
          'inline-block leading-none rounded select-none space-x-2'
              + ' active:bg-tc-gray-600 focus:bg-tc-gray-600'
              + (!dense ? ' p-2 ' : '-m-1 p-1')
              + (className ? ` ${className}` : '')
        }
        {...props}
    >
      {icon ? <FabricIcon name={icon} className="align-bottom" /> : ''}
      {ariaLabel ? <span className="sr-only">{ariaLabel}</span> : ''}
      {label ? <span>{label}</span> : ''}
    </button>
  </>;
}

