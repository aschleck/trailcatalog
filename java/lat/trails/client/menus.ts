import { MenuEntries } from 'external/dev_april_corgi+/js/emu/menu/menu_controller';

import { UnitSystem } from 'js/units/formatters';
import { Collection, ListCollectionsResponse } from 'trails_lat/proto/data_pb';

import { FeatureStore } from './feature_store';

/** What the File menu's items do. */
export interface FileActions {
  newCollection(): void;
  openCollection(collection: Collection): void;
  openSettings(): void;
  importFiles(): void;
  exportGpx(): void;
  exportGeoJson(): void;
}

export function fileMenu(
    listing: ListCollectionsResponse,
    hasCollection: boolean,
    readOnly: boolean,
    actions: FileActions): MenuEntries {
  const items: MenuEntries = [{
    kind: 'menu_item',
    label: 'New',
    action: () => {
      actions.newCollection();
    },
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
  items.push({
    kind: 'menu_item',
    label: 'Settings',
    disabled: !hasCollection,
    action: () => {
      actions.openSettings();
    },
  });
  items.push({kind: 'divider'});
  items.push({
    kind: 'menu_item',
    label: 'Import',
    disabled: readOnly,
    action: () => {
      actions.importFiles();
    },
  });
  items.push({
    kind: 'menu',
    label: 'Export',
    items: [{
      kind: 'menu_item',
      label: 'GPX',
      action: () => {
        actions.exportGpx();
      },
    }, {
      kind: 'menu_item',
      label: 'GeoJSON',
      action: () => {
        actions.exportGeoJson();
      },
    }],
  });
  return items;
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

export function viewMenu(system: UnitSystem, choose: (system: UnitSystem) => void): MenuEntries {
  return [{
    kind: 'checkbox_menu_item',
    label: 'Imperial',
    checked: system === 'imperial',
    action: () => {
      choose('imperial');
    },
  }, {
    kind: 'checkbox_menu_item',
    label: 'Metric',
    checked: system === 'metric',
    action: () => {
      choose('metric');
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

export const USER_MENU: MenuEntries = [{
  kind: 'menu_item',
  label: 'Log out',
  action: () => {
    // Force a page refresh as part of logging out
    window.location.href = '/logout';
  },
}];
