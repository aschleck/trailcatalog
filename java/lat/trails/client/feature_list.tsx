import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { Button } from 'external/dev_april_corgi+/js/emu/button';
import { ACTION, CHANGED } from 'external/dev_april_corgi+/js/emu/events';
import { Input } from 'external/dev_april_corgi+/js/emu/input';
import { Select } from 'external/dev_april_corgi+/js/emu/select';

import {
  DEFAULT_LINE_COLOR,
  DEFAULT_POINT_COLOR,
  DEFAULT_WIDTH_PX,
  EditableFeature,
  EditableFolder,
} from './features';
import { formatDistance, formatHeight, measureLine } from './measurements';

export interface TreeItem {
  feature: EditableFeature;
  children: TreeItem[];
}

export interface FeatureListState {
  tree: TreeItem[];
  // Every folder in tree order with its depth, for the move menu
  folders: Array<{folder: EditableFolder; depth: number}>;
  selected: EditableFeature|undefined;
  // How many features deleting the selected folder takes with it
  selectedDescendants: number;
  hidden: ReadonlySet<string>;
  expanded: ReadonlySet<string>;
}

const WIDTHS_PX = [1, 2, 3, 4, 6, 8];

/** Lists the open collection's features as a tree, with the selected one's properties below. */
export function FeatureList({state}: {state: FeatureListState}) {
  return <>
    <div className="bg-white border-gray-300 border-r flex flex-col h-full min-h-0 text-sm w-72">
      <div className="border-b border-gray-300 flex items-center justify-between px-2 py-1">
        <span className="font-bold">Features</span>
        <Button
            ariaLabel="New folder"
            className="hover:bg-black/10 px-2 py-0.5 rounded"
            title="New folder"
            unboundEvents={{corgi: [[ACTION, 'newFolderClicked']]}}
        >
          New folder
        </Button>
      </div>
      <div className="grow min-h-0 overflow-y-auto py-1">
        {state.tree.length > 0
            ? rows(state.tree, 0, state)
            : [
              <div className="px-2 py-1 text-gray-500">
                Draw or import something to see it here.
              </div>,
            ]
        }
      </div>
      {state.selected
          ? <Properties
                feature={state.selected}
                folders={state.folders}
                descendants={state.selectedDescendants}
            />
          : ''
      }
    </div>
  </>;
}

function rows(
    items: TreeItem[], depth: number, state: FeatureListState): corgi.VElementOrPrimitive[] {
  const rendered = [];
  for (const item of items) {
    const feature = item.feature;
    const expanded = state.expanded.has(feature.id);
    rendered.push(
        <Row
            key={feature.id}
            depth={depth}
            expanded={expanded}
            feature={feature}
            selected={state.selected?.id === feature.id}
            visible={!state.hidden.has(feature.id)}
        />);
    if (feature.kind === 'folder' && expanded) {
      rendered.push(...rows(item.children, depth + 1, state));
    }
  }
  return rendered;
}

function Row({depth, expanded, feature, selected, visible}: {
  depth: number;
  expanded: boolean;
  feature: EditableFeature;
  key: string;
  selected: boolean;
  visible: boolean;
}) {
  return (
    <div
        className={
          'cursor-pointer flex gap-1 items-center pr-2 py-0.5 select-none '
              + (selected ? 'bg-blue-100' : 'hover:bg-gray-100')
        }
        data={{id: feature.id}}
        style={`padding-left: ${0.5 + depth}rem`}
        unboundEvents={{click: 'featureClicked'}}
    >
      <input
          ariaLabel={visible ? 'Hide' : 'Show'}
          checked={visible}
          data={{id: feature.id}}
          type="checkbox"
          unboundEvents={{click: 'visibilityToggled'}}
      />
      <Swatch expanded={expanded} feature={feature} />
      <span className={'truncate' + (feature.data.name ? '' : ' italic text-gray-500')}>
        {feature.data.name || untitled(feature)}
      </span>
    </div>
  );
}

function Swatch({expanded, feature}: {expanded: boolean; feature: EditableFeature}) {
  if (feature.kind === 'folder') {
    return <span className="text-center text-gray-600 w-4">{expanded ? '▾' : '▸'}</span>;
  } else if (feature.kind === 'line') {
    return (
      <svg className="h-4 shrink-0 w-4" viewBox="0 0 16 16">
        <path
            d="M2 12 L6 6 L10 10 L14 4"
            fill="none"
            stroke={feature.data.stroke ?? DEFAULT_LINE_COLOR}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
        />
      </svg>
    );
  } else {
    return (
      <svg className="h-4 shrink-0 w-4" viewBox="0 0 16 16">
        <circle
            cx="8"
            cy="8"
            fill={feature.data.fill ?? DEFAULT_POINT_COLOR}
            r="4"
            stroke="white"
            strokeWidth="1.5"
        />
      </svg>
    );
  }
}

function Properties({descendants, feature, folders}: {
  descendants: number;
  feature: EditableFeature;
  folders: Array<{folder: EditableFolder; depth: number}>;
}) {
  return (
    <div className="border-gray-300 border-t flex flex-col gap-2 p-2">
      <Input
          className="border border-gray-300 px-1 rounded"
          forceValue={true}
          placeholder={untitled(feature)}
          value={feature.data.name ?? ''}
          unboundEvents={{corgi: [[CHANGED, 'nameChanged']]}}
      />
      {feature.kind !== 'folder'
          ? <textarea
                className="border border-gray-300 px-1 rounded"
                placeholder="Description"
                value={feature.data.description ?? ''}
                unboundEvents={{input: 'descriptionChanged'}}
            />
          : ''
      }
      <div className="flex gap-2 items-center">
        {feature.kind !== 'folder'
            ? <input
                  ariaLabel="Color"
                  className="h-7 shrink-0 w-10"
                  type="color"
                  value={
                    feature.kind === 'line'
                        ? feature.data.stroke ?? DEFAULT_LINE_COLOR
                        : feature.data.fill ?? DEFAULT_POINT_COLOR
                  }
                  unboundEvents={{input: 'colorChanged'}}
              />
            : ''
        }
        {feature.kind === 'line'
            ? <Select
                  ariaLabel="Width"
                  className="border border-gray-300 rounded shrink-0 w-20"
                  options={WIDTHS_PX.map(width => ({
                    label: `${width} px`,
                    value: String(width),
                    selected: width === (feature.data.width_px ?? DEFAULT_WIDTH_PX),
                  }))}
                  unboundEvents={{corgi: [[CHANGED, 'widthChanged']]}}
              />
            : ''
        }
        <Select
            ariaLabel="Folder"
            className="border border-gray-300 grow min-w-0 rounded"
            options={[
              {label: 'No folder', value: '', selected: !feature.data.folder_id},
              ...folders
                  .filter(({folder}) => folder.id !== feature.id)
                  .map(({folder, depth}) => ({
                    label: `${'  '.repeat(depth)}${folder.data.name || 'Untitled folder'}`,
                    value: folder.id,
                    selected: folder.id === feature.data.folder_id,
                  })),
            ]}
            unboundEvents={{corgi: [[CHANGED, 'folderChanged']]}}
        />
      </div>
      <Stats feature={feature} />
      <Button
          className="bg-red-700 hover:bg-red-800 px-2 py-1 rounded self-start text-white"
          unboundEvents={{corgi: [[ACTION, 'deleteClicked']]}}
      >
        {feature.kind === 'folder' && descendants > 0
            ? `Delete folder and ${descendants} ${descendants === 1 ? 'item' : 'items'}`
            : 'Delete'}
      </Button>
    </div>
  );
}

function Stats({feature}: {feature: EditableFeature}) {
  if (feature.kind === 'line') {
    const stats = measureLine(feature.latLngE7, feature.elevationCentimeters);
    const elevation = stats.elevation;
    return (
      <div className="text-gray-700">
        {formatDistance(stats.lengthMeters)}
        {elevation
            ? `, ${formatHeight(elevation.upMeters)} up, ${formatHeight(elevation.downMeters)} down`
            : ''}
      </div>
    );
  } else if (feature.kind === 'point') {
    return (
      <div className="text-gray-700">
        {`${(feature.latE7 / 1e7).toFixed(5)}, ${(feature.lngE7 / 1e7).toFixed(5)}`}
        {feature.elevationCentimeters !== undefined
            ? `, ${formatHeight(feature.elevationCentimeters / 100)}`
            : ''}
      </div>
    );
  } else {
    return <div className="hidden" />;
  }
}

function untitled(feature: EditableFeature): string {
  return feature.kind === 'folder'
      ? 'Untitled folder'
      : feature.kind === 'line' ? 'Untitled line' : 'Untitled point';
}

/** Sorts folders ahead of everything else and names in the order a person would number them. */
export function buildTree(
    features: Iterable<EditableFeature>,
    parentOf: (feature: EditableFeature) => string|undefined): TreeItem[] {
  const children = new Map<string|undefined, TreeItem[]>();
  const items = new Map<string, TreeItem>();
  for (const feature of features) {
    items.set(feature.id, {feature, children: []});
  }
  for (const item of items.values()) {
    const parent = parentOf(item.feature);
    const siblings = children.get(parent) ?? [];
    siblings.push(item);
    children.set(parent, siblings);
  }
  for (const item of items.values()) {
    item.children = sortItems(children.get(item.feature.id) ?? []);
  }
  return sortItems(children.get(undefined) ?? []);
}

/** Flattens the folders of a tree in order, with their depth. */
export function foldersOf(tree: TreeItem[], depth = 0):
    Array<{folder: EditableFolder; depth: number}> {
  const folders = [];
  for (const item of tree) {
    if (item.feature.kind === 'folder') {
      folders.push({folder: item.feature, depth});
      folders.push(...foldersOf(item.children, depth + 1));
    }
  }
  return folders;
}

function sortItems(items: TreeItem[]): TreeItem[] {
  return items.sort((a, b) => {
    const aFolder = a.feature.kind === 'folder';
    const bFolder = b.feature.kind === 'folder';
    if (aFolder !== bFolder) {
      return aFolder ? -1 : 1;
    }
    return (a.feature.data.name ?? '').localeCompare(
        b.feature.data.name ?? '', undefined, {numeric: true});
  });
}
