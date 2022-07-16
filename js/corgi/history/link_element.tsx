import * as corgi from 'js/corgi';

import { LinkController, State } from './link_controller';

export function Link({children, href}: {
  // TODO(april): why does this need to be typed optional?
  children?: corgi.VElementOrPrimitive[],
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
        href={href}>
      {children ? children : []}
    </a>
  </>;
}
