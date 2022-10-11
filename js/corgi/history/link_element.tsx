import * as corgi from 'js/corgi';

import { LinkController, State } from './link_controller';

export function Link({children, className, href}: {
  // TODO(april): why does this need to be typed optional?
  children?: corgi.VElementOrPrimitive[],
  className?: string;
  href: string,
}, state: State|undefined, updateState: (newState: State) => void) {
  return <>
    <a
        js={corgi.bind({
          controller: LinkController,
          events: {
            click: 'onClick',
          },
          state: [state ?? {}, updateState],
        })}
        className={className ?? ''}
        href={href}>
      {children ?? []}
    </a>
  </>;
}
