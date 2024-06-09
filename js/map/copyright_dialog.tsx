import * as corgi from 'external/dev_april_corgi~/js/corgi';

import { Button } from 'external/dev_april_corgi~/js/emu/button';
import { ACTION } from 'external/dev_april_corgi~/js/emu/events';

import { Copyright } from './common/types';

export function CopyrightDialog({copyrights}: {copyrights: Copyright[]}) {
  const elements = [];
  for (const copyright of copyrights) {
    if (copyright.url) {
      elements.push(<a href={copyright.url}>{copyright.long}</a>);
    } else {
      elements.push(copyright.long);
    }
  }
  return <>
    <div className="bg-gray-900 p-4 rounded text-white">
      <div className="text-end">
        <Button
            ariaLabel="Close"
            unboundEvents={{
              corgi: [
                [ACTION, 'close'],
              ],
            }}
        >
          <svg className="h-4 stroke-white w-4" viewBox="0 0 12 12">
            <path d="M0 0 L12 12 M0 12 L12 0" />
          </svg>
        </Button>
      </div>
      <ul className="list-disc list-inside">
        {elements.map(c => <li>{c}</li>)}
      </ul>
    </div>
  </>;
}
