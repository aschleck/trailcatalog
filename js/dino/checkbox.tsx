import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { InputCheckboxProperties } from 'external/dev_april_corgi+/js/corgi/elements';

import { FabricIcon, FabricIconName } from './fabric';

type CheckboxProps = Omit<InputCheckboxProperties, 'type'>;

export function Checkbox({label, ...props}: {
  label?: corgi.VElementOrPrimitive,
} & CheckboxProps) {
  return <>
    <IconCheckbox
        icons={{checked:'CheckboxCompositeReversed', unchecked:'Checkbox'}}
        label={label}
        {...props}
    />
  </>;
}

export function IconCheckbox({checked, className, icons, label, ...props}: {
  className?: string,
  icons: {checked: FabricIconName, unchecked: FabricIconName},
  label?: corgi.VElementOrPrimitive,
} & CheckboxProps) {
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

