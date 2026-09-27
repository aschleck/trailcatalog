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
//
// The bar sits above the overlay an open menu covers the page with, or else the overlay swallows
// the hover that switches to another menu.
export function Menubar({children, user}: {
  children?: VElementOrPrimitive|VElementOrPrimitive[];
  user: User|undefined;
}) {
  return <>
    <div
        className="bg-gray-900 flex gap-1 items-center px-2 py-1 relative text-white z-20"
        unboundEvents={{click: 'menubarClicked'}}
    >
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
                data={{menu: 'user'}}
                unboundEvents={{click: 'userMenuClicked', pointerenter: 'menubarMenuEntered'}}
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

// Hovering an item with a menu while another menu is open switches to it, so the controller's
// menubarMenuEntered has to know which menu the item opens.
export function MenubarItem({label, menu, onClick}: {
  label: string;
  menu?: string;
  onClick: string;
}) {
  return <>
    <div
        className="cursor-pointer hover:bg-gray-800 px-2 py-1 rounded select-none"
        data={menu ? {menu} : {}}
        unboundEvents={
          menu ? {click: onClick, pointerenter: 'menubarMenuEntered'} : {click: onClick}
        }
    >
      {label}
    </div>
  </>;
}
