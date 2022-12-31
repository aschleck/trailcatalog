import * as corgi from 'js/corgi';

import { ButtonController, State } from './button_controller';
import { FabricIcon, FabricIconName } from './fabric';

export function FlatButton({className, dense, icon, label, ...props}: {
  className?: string,
  dense?: boolean,
  icon?: FabricIconName,
  label?: string,
} & corgi.Properties<HTMLButtonElement>) {
  return <>
    <Button
        className={'active:bg-tc-gray-400' + (className ? ` ${className}` : '')}
        dense={dense}
        icon={icon}
        label={label}
        {...props} />
  </>;
}

export function OutlinedButton({className, dense, icon, label, ...props}: {
  dense?: boolean,
  icon?: FabricIconName,
  label?: string,
} & corgi.Properties<HTMLButtonElement>) {
  return <>
    <Button
        className={
            'border-[1px] border-tc-gray-400 active:bg-tc-gray-400'
                + (className ? ` ${className}` : '')
        }
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
      icon?: FabricIconName,
      label?: string,
    } & corgi.Properties<HTMLButtonElement>,
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
          'inline-block leading-none rounded select-none space-x-2 '
              + (!dense ? ' p-2 ' : '-m-1 p-1')
              + (className ? ` ${className}` : '')
        }
        {...props}
    >
      {icon ? <FabricIcon name={icon} className="align-bottom" /> : ''}
      {label ? <span>{label}</span> : ''}
    </button>
  </>;
}

