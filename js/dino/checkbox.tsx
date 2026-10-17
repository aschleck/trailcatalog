import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { InputCheckboxProperties } from 'external/dev_april_corgi+/js/corgi/elements';

import { FluentIcon, FluentIconName } from './fluent';

type CheckboxProps = Omit<InputCheckboxProperties, 'type'>;

export function Checkbox({label, ...props}: {
  label?: corgi.VElementOrPrimitive,
} & CheckboxProps) {
  return <>
    <IconCheckbox
        icons={{checked:'CheckboxCheckedFilled', unchecked:'CheckboxUnchecked'}}
        label={label}
        {...props}
    />
  </>;
}

export function IconCheckbox({checked, className, icons, label, ...props}: {
  className?: string,
  icons: {checked: FluentIconName, unchecked: FluentIconName},
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
      <FluentIcon name={checked ?? false ? icons.checked : icons.unchecked} />
      {label ?? ''}
    </label>
  </>;
}

