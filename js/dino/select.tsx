import * as corgi from 'js/corgi';

import { SelectController, State } from './select_controller';

export function Select(
    {className, options, ref, ...props}: {
      className?: string,
      ref?: string,
      options: Array<{
        label: string;
        value: string;
      }>,
    } & corgi.Properties,
    state: State|undefined,
    updateState: (newState: State) => void) {
  if (!state) {
    state = {};
  }

  return <>
    <label className={className} {...props}>
      <select
          className={
            'border border-tc-gray-400 overflow-hidden p-1 rounded'
                + (className ? ` ${className}` : '')
          }
          js={corgi.bind({
            controller: SelectController,
            events: {
              'change': 'changed',
            },
            ref,
            state: [state, updateState],
          })}
      >
        {options.map(o => <option value={o.value}>{o.label}</option>)}
      </select>
    </label>
  </>;
}

