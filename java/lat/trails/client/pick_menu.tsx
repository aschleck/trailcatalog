import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { InfoMenuItem, MenuItem } from 'external/dev_april_corgi+/js/emu/menu/menu_controller';
import { MenuClassNames } from 'external/dev_april_corgi+/js/emu/menu/menu_element';

import { FeatureIcon, kindName, untitled } from './feature_list';
import { EditableFeature } from './features';
import { CollectionSchema, titleOf } from './schema';

/** One of the things under a click that the pick menu lets the person choose between. */
export type Choice =
    {kind: 'feature'; feature: EditableFeature; schema: CollectionSchema}
    |{kind: 'object'; shape: 'line'|'point'|'polygon'; title: string|undefined; source: string};

// Light, unlike the menubar's, because it opens over the map instead of hanging off the dark bar
export const PICK_MENU_CLASSES: MenuClassNames = {
  popup: 'bg-white py-1 rounded shadow-lg text-gray-900 text-sm',
  item: 'cursor-pointer data-[active]:bg-gray-100 px-3 py-1 select-none',
  divider: 'bg-gray-200 h-px my-1',
  detail: 'text-gray-500 text-xs',
  icon: 'me-2',
  info: 'px-3 py-0.5 text-gray-600',
};

/** Returns the row that offers a choice, which action opens and onActive highlights. */
export function choiceItem(
    choice: Choice, action: () => void, onActive: (active: boolean) => void): MenuItem {
  let icon;
  let label;
  let detail;
  if (choice.kind === 'feature') {
    icon = <FeatureIcon feature={choice.feature} schema={choice.schema} />;
    label = titleOf(choice.schema, choice.feature) || untitled(kindName(choice.feature));
    detail = 'Features';
  } else if (choice.kind === 'object') {
    icon = <ShapeIcon shape={choice.shape} />;
    label = choice.title || untitled(choice.shape);
    detail = choice.source;
  } else {
    throw checkExhaustive(choice);
  }
  return {kind: 'menu_item', label, detail, icon, action, onActive};
}

/** Returns the row that shows what a layer reads at the clicked spot. */
export function readingItem({name, value}: {name: string; value: string}): InfoMenuItem {
  return {
    kind: 'info_menu_item',
    label: name,
    value: <span className="font-medium text-gray-900 whitespace-nowrap">{value}</span>,
  };
}

function ShapeIcon({shape}: {shape: 'line'|'point'|'polygon'}) {
  let path;
  if (shape === 'line') {
    path = <path d="M2 12 L6 6 L10 10 L14 4" />;
  } else if (shape === 'point') {
    path = <circle cx="8" cy="8" r="4" />;
  } else if (shape === 'polygon') {
    path = <path d="M3 4 L12 2.5 L13.5 12 L4 13.5 Z" />;
  } else {
    throw checkExhaustive(shape);
  }
  return (
    <svg
        className="h-4 shrink-0 stroke-current text-gray-600 w-4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 16 16"
    >
      {path}
    </svg>
  );
}
