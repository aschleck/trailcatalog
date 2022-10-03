import * as corgi from 'js/corgi';

import { FlatButton } from './button';

export function Checkbox({checked, className, ...props}: {
  checked?: boolean,
  className?: string,
} & corgi.Properties<HTMLElement>) {
  return <>
    <FlatButton
        className={'height-[1em]' + (className ? ` ${className}` : '')}
        icon={checked ?? false ? 'CheckboxComposite' : 'Checkbox'}
        {...props}
    />
  </>;
}

