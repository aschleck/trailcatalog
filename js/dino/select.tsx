import * as corgi from 'js/corgi';

import { Select as EmuSelect } from 'js/emu/select';

export function Select(
    {className, ...props}: {
      className?: string,
      ref?: string,
      options: Array<{
        label: string;
        value: string;
      }>,
    } & corgi.Properties) {
  return <>
    <EmuSelect 
        className={
          'border border-tc-gray-400 overflow-hidden p-1 rounded'
              + (className ? ` ${className}` : '')
        }
        {...props}
    />
  </>;
}

