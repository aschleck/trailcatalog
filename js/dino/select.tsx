import * as corgi from 'external/dev_april_corgi+/js/corgi';

import { Select as EmuSelect } from 'external/dev_april_corgi+/js/emu/select';

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

