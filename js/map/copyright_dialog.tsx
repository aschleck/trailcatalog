import * as corgi from 'external/dev_april_corgi+/js/corgi';

import { DIALOG, DialogHeader } from 'js/pika/dialog';

import { Copyright } from './common/types';

export function CopyrightDialog({copyrights}: {copyrights: Copyright[]}) {
  const elements = [];
  for (const copyright of copyrights) {
    const credit = copyright.url ? <a href={copyright.url}>{copyright.long}</a> : copyright.long;
    if (copyright.license) {
      elements.push(<>{credit} (<a href={copyright.license.url}>{copyright.license.name}</a>)</>);
    } else {
      elements.push(credit);
    }
  }
  return <>
    <div className={`${DIALOG} max-w-lg`}>
      <DialogHeader title="Credits" />
      <ul className="flex flex-col gap-1 list-disc pl-4">
        {elements.map(c => <li>{c}</li>)}
      </ul>
    </div>
  </>;
}
