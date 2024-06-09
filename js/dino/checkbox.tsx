import * as corgi from 'external/dev_april_corgi~/js/corgi';

import { FabricIcon, FabricIconName } from './fabric';

export function Checkbox({label, ...props}: {
  label?: corgi.VElementOrPrimitive,
} & corgi.InputProperties) {
  return <>
    <IconCheckbox
        icons={{checked:'CheckboxCompositeReversed', unchecked:'Checkbox'}}
        label={label}
        {...props}
    />
  </>;
}

export function IconCheckbox({checked, className, icons, label, ...props}: {
  checked?: boolean,
  className?: string,
  icons: {checked: FabricIconName, unchecked: FabricIconName},
  label?: corgi.VElementOrPrimitive,
} & corgi.InputProperties) {
  return <>
    <label className={className}>
      <input
          checked={checked}
          className="absolute appearance-none height-[1em] peer"
          type="checkbox"
          {...props}
      />
      <FabricIcon name={checked ?? false ? icons.checked : icons.unchecked} />
      {label ?? ''}
    </label>
  </>;
}

