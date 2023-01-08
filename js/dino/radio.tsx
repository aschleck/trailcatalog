import * as corgi from 'js/corgi';

export function Radio({className, name, options, value, ...props}: {
  className?: string,
  name: string,
  options: Array<{
    label: string;
    value: string;
  }>,
  value: string,
} & corgi.Properties<HTMLElement>) {
  return <>
    <div
        className={'border border-tc-gray-400 flex h-full rounded' + (className ? ` ${className}` : '')}
        {...props}
    >
      {options.map(o =>
          <label
              className={
                'border-r border-tc-gray-400 flex h-full items-center px-2'
                    + ' focus-within:[outline:auto] last:border-r-0'
                    + (
                        o.value === value
                            ? ' bg-tc-highlight-2 text-tc-gray-900'
                            : ' text-tc-gray-400'
                    )
              }
          >
            <input
                checked={o.value === value}
                className="appearance-none overflow-hidden"
                name={name}
                type="radio"
                value={o.value}
            />
            {o.label}
          </label>
      )}
    </div>
  </>;
}

