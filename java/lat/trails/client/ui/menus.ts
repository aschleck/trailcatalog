import { MenuEntries } from 'external/dev_april_corgi+/js/emu/menu/menu_controller';

import { UnitSystem } from 'js/units/formatters';
import { Collection, ListCollectionsResponse } from 'trails_lat/proto/data_pb';

import { FeatureStore } from '../model/feature_store';
import { ZoneChoice } from '../sky/time_zones';

/** What the File menu's items do. */
export interface FileActions {
  newCollection: () => void;
  openCollection: (collection: Collection) => void;
  openSettings: () => void;
  importFiles: () => void;
  exportFiles: () => void;
}

export function fileMenu(
    listing: ListCollectionsResponse,
    hasCollection: boolean,
    readOnly: boolean,
    actions: FileActions): MenuEntries {
  const items: MenuEntries = [{
    kind: 'menu_item',
    label: 'New',
    action: actions.newCollection,
  }];
  for (const [label, collections] of [
    ['Open', listing.collections],
    ['Open shared', listing.shared],
  ] as const) {
    if (collections.length > 0) {
      items.push({
        kind: 'menu',
        label,
        items: collections.map(collection => ({
          kind: 'menu_item' as const,
          label: collection.name,
          action: () => {
            actions.openCollection(collection);
          },
        })),
      });
    } else if (label === 'Open') {
      items.push({kind: 'menu_item', label, disabled: true, action: () => {}});
    }
  }
  return [...items, ...collectionMenu(hasCollection, readOnly, actions)];
}

/** The File menu's items about the open collection, which the phone layout's chip offers. */
export function collectionMenu(
    hasCollection: boolean,
    readOnly: boolean,
    actions: Pick<FileActions, 'openSettings'|'importFiles'|'exportFiles'>): MenuEntries {
  return [{
    kind: 'menu_item',
    label: 'Settings…',
    disabled: !hasCollection,
    action: actions.openSettings,
  }, {
    kind: 'divider',
  }, {
    kind: 'menu_item',
    label: 'Import…',
    disabled: readOnly,
    action: actions.importFiles,
  }, {
    kind: 'menu_item',
    label: 'Export…',
    action: actions.exportFiles,
  }];
}

export function editMenu(store: FeatureStore): MenuEntries {
  const mac = navigator.platform.startsWith('Mac');
  return [{
    kind: 'menu_item',
    label: 'Undo',
    disabled: !store.canUndo,
    shortcut: mac ? '⌘Z' : 'Ctrl+Z',
    action: () => {
      store.undo();
    },
  }, {
    kind: 'menu_item',
    label: 'Redo',
    disabled: !store.canRedo,
    shortcut: mac ? '⇧⌘Z' : 'Ctrl+Y',
    action: () => {
      store.redo();
    },
  }];
}

export function viewMenu(
    system: UnitSystem,
    chooseSystem: (system: UnitSystem) => void,
    zone: ZoneChoice,
    chooseZone: (zone: ZoneChoice) => void): MenuEntries {
  return [{
    kind: 'checkbox_menu_item',
    label: 'Imperial',
    checked: system === 'imperial',
    action: () => {
      chooseSystem('imperial');
    },
  }, {
    kind: 'checkbox_menu_item',
    label: 'Metric',
    checked: system === 'metric',
    action: () => {
      chooseSystem('metric');
    },
  }, {
    kind: 'divider',
  }, {
    kind: 'checkbox_menu_item',
    label: 'Device time zone',
    checked: zone === 'device',
    action: () => {
      chooseZone('device');
    },
  }, {
    kind: 'checkbox_menu_item',
    label: 'Map time zone',
    checked: zone === 'map',
    action: () => {
      chooseZone('map');
    },
  }];
}

export const HELP_MENU: MenuEntries = [{
  kind: 'menu_item',
  label: 'Visit the open-source project',
  action: () => {
    window.open('https://github.com/aschleck/trailcatalog', '_blank', 'noopener');
  },
}, {
  kind: 'menu_item',
  label: 'Report a bug',
  action: () => {
    window.open('https://github.com/aschleck/trailcatalog/issues', '_blank', 'noopener');
  },
}];

// The phone layout has no View menu, so it passes viewMenu's items to show here instead.
export function userMenu(openAccount: () => void, view: MenuEntries = []): MenuEntries {
  return [{
    kind: 'menu_item',
    label: 'Account…',
    action: openAccount,
  }, {
    kind: 'divider',
  }, ...withDivider(view), {
    kind: 'menu_item',
    label: 'Log out',
    action: () => {
      // Force a page refresh as part of logging out
      window.location.href = '/logout';
    },
  }];
}

/** The phone layout's account menu for somebody logged out. */
export function guestMenu(logIn: () => void, view: MenuEntries): MenuEntries {
  return [{
    kind: 'menu_item',
    label: 'Log in',
    action: logIn,
  }, {
    kind: 'divider',
  }, ...view];
}

function withDivider(entries: MenuEntries): MenuEntries {
  return entries.length > 0 ? [...entries, {kind: 'divider'}] : [];
}
