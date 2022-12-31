import * as corgi from 'js/corgi';

import { Button } from './button';

export function Checkbox({checked, className, ...props}: {
  checked?: boolean,
  className?: string,
} & corgi.Properties<HTMLElement>) {
  return <>
    <Button
        className={'height-[1em]' + (className ? ` ${className}` : '')}
        icon={checked ?? false ? 'CheckboxCompositeReversed' : 'Checkbox'}
        {...props}
    />
  </>;
}

