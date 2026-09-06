import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { VElementOrPrimitive } from 'external/dev_april_corgi+/js/corgi';
import { MenuClassNames } from 'external/dev_april_corgi+/js/emu/menu/menu_element';

import { User } from 'trails_lat/proto/data_pb';

// MenuElement ships unstyled, so every menu the bar opens has to bring the bar's own colors.
export const MENU_CLASSES: MenuClassNames = {
  popup: 'bg-gray-900 p-1 rounded shadow-lg text-white',
  item: 'cursor-pointer px-2 py-1 rounded select-none data-[active]:bg-gray-800',
  divider: '-mx-1 my-1 h-px bg-white opacity-25',
};

// Menus are opened by whatever controller wraps the bar, because that is what owns the state they
// show. Clicks reach it through unboundEvents, so the bar itself binds no controller.
export function Menubar({children, user}: {
  children?: VElementOrPrimitive|VElementOrPrimitive[];
  user: User|undefined;
}) {
  return <>
    <div className="bg-gray-900 flex gap-1 items-center px-2 py-1 text-white">
      <a className="no-underline px-2 py-1" href="/">
        <img alt="trails.lat" className="h-8" src="/static/cat_moon.webp" />
      </a>
      {children ?? []}
      <div className="grow" />
      {user
          ? <div
                className="
                    cursor-pointer
                    hover:bg-gray-800
                    max-w-64
                    px-2
                    py-1
                    rounded
                    select-none
                    truncate
                "
                unboundEvents={{click: 'userMenuClicked'}}
            >
              {user.pictureUrl
                  ? <img
                        alt={user.displayName}
                        className="h-6 rounded-full w-6"
                        src={user.pictureUrl}
                    />
                  : user.displayName
              }
            </div>
          : <MenubarItem label="Log in" onClick="loginClicked" />
      }
    </div>
  </>;
}

export function MenubarItem({label, onClick}: {label: string; onClick: string}) {
  return <>
    <div
        className="cursor-pointer hover:bg-gray-800 px-2 py-1 rounded select-none"
        unboundEvents={{click: onClick}}
    >
      {label}
    </div>
  </>;
}
