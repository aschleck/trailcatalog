import * as corgi from 'js/corgi';

import { ButtonController, State } from './button_controller';

type ButtonProps = {
  ariaLabel?: string,
  children?: corgi.VElementOrPrimitive[],
  className?: string;
} & corgi.Properties;

export function Button(
    {ariaLabel, children, className, ...props}: ButtonProps,
    state: State|undefined,
    updateState: (newState: State) => void) {
  if (!state) {
    state = {};
  }

  return <>
    <label className={'inline-block' + (className ? ` ${className}` : '')} {...props}>
      <button
          js={corgi.bind({
            controller: ButtonController,
            events: {
              'click': 'clicked',
              'keyup': 'keyPressed',
            },
            state: [state, updateState],
          })}
          ariaLabel={ariaLabel}
          className={'h-full w-full'}
      >
        {children}
      </button>
    </label>
  </>;
}

export function Link(
    {children, className, ...props}: ButtonProps,
    state: State|undefined,
    updateState: (newState: State) => void) {
  if (!state) {
    state = {};
  }

  return <>
    <span {...props}>
      <a
          js={corgi.bind({
            controller: ButtonController,
            events: {
              'click': 'clicked',
              'keyup': 'keyPressed',
            },
            state: [state, updateState],
          })}
          className={'cursor-pointer' + (className ? ` ${className}` : '')}
      >
        {children}
      </a>
    </span>
  </>;
}

