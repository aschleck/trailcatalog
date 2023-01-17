import * as corgi from 'js/corgi';
import { Radio } from 'js/dino/radio';

import { getUnitSystem } from './common/ssr_aware';

import { State, UnitSelectorController } from './unit_selector_controller';

export function UnitSelector({
  className,
}: {
  className?: string,
}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    state = {system: getUnitSystem()};
  }

  return <>
    <div
        className={className}
        js={corgi.bind({
          controller: UnitSelectorController,
          events: {
            change: 'select',
          },
          state: [state, updateState],
        })}
    >
      <Radio
          name="unit"
          className="text-sm"
          value={state.system}
          options={[
            {label: 'km', value: 'metric'},
            {label: 'mi', value: 'imperial'},
          ]}
      />
    </div>
  </>;
}

