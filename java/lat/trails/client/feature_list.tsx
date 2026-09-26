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
import { PointMarker } from './icon_picker';
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
  // The feature under the pointer, here or on the map, and the folders it is inside
  hovered: string|undefined;
  hoveredAncestors: ReadonlySet<string>;
  hidden: ReadonlySet<string>;
  expanded: ReadonlySet<string>;
}

const WIDTHS_PX = [1, 2, 3, 4, 6, 8];
const EYE_OUTLINE =
    'M1.5 8 C3.5 4.5 5.5 3.5 8 3.5 C10.5 3.5 12.5 4.5 14.5 8 '
        + 'C12.5 11.5 10.5 12.5 8 12.5 C5.5 12.5 3.5 11.5 1.5 8 Z';

/** Lists the open collection's features as a tree. */
export function FeatureTree({state}: {state: FeatureListState}) {
  return (
    <div>
      {state.tree.length > 0
          ? rows(state.tree, state, /* dimmed= */ false)
          : [
            <div className="px-2 py-1 text-gray-500">
              Draw or import something to see it here.
            </div>,
          ]
      }
    </div>
  );
}

export function NewFolderButton() {
  return (
    <Button
        ariaLabel="New folder"
        className="hover:bg-black/10 p-1 rounded"
        title="New folder"
        unboundEvents={{corgi: [[ACTION, 'newFolderClicked']]}}
    >
      <svg className="h-4 stroke-current w-4" fill="none" viewBox="0 0 16 16">
        <FolderShape />
        <path d="M8 7.5 V12.5 M5.5 10 H10.5" strokeWidth="1.3" />
      </svg>
    </Button>
  );
}

/**
 * Lists the map's layers topmost first, the way they stack, which is the reverse of the order they
 * come in and the map draws them.
 */
export function LayerList({layers}: {layers: Array<{name: string; enabled: boolean}>}) {
  const rows = [];
  for (let i = layers.length - 1; i >= 0; --i) {
    const layer = layers[i];
    rows.push(
        <div
            className={
              'cursor-pointer flex gap-1.5 h-7 hover:bg-gray-100 items-center pl-6 pr-2 '
                  + 'select-none '
                  + (layer.enabled ? '' : 'opacity-50')
            }
            data={{index: i}}
            unboundEvents={{click: 'layerToggled'}}
        >
          <span className="grow truncate">{layer.name}</span>
          <span className="text-gray-500">
            <Eye visible={layer.enabled} />
          </span>
        </div>);
  }
  return <div>{rows}</div>;
}

function Chevron({expanded}: {expanded: boolean}) {
  return (
    <svg className="h-3 shrink-0 stroke-current text-gray-500 w-3" fill="none" viewBox="0 0 16 16">
      <path d={expanded ? 'M3 6 L8 11 L13 6' : 'M6 3 L11 8 L6 13'} strokeWidth="2" />
    </svg>
  );
}

function Eye({visible}: {visible: boolean}) {
  return (
    <svg className="h-4 shrink-0 stroke-current w-4" fill="none" viewBox="0 0 16 16">
      <path d={EYE_OUTLINE} strokeWidth="1.3" />
      {visible
          ? <circle cx="8" cy="8" fill="currentColor" r="2" />
          : <path d="M2.5 13.5 L13.5 2.5" strokeWidth="1.3" />
      }
    </svg>
  );
}

// A folder's children sit in a container with a guide line down its left edge, under the
// folder's chevron, the way a tree in an outliner shows what belongs to what.
function rows(
    items: TreeItem[], state: FeatureListState, dimmed: boolean): corgi.VElementOrPrimitive[] {
  const rendered = [];
  for (const item of items) {
    const feature = item.feature;
    const expanded = state.expanded.has(feature.id);
    const hidden = dimmed || state.hidden.has(feature.id);
    rendered.push(
        <Row
            key={feature.id}
            dimmed={hidden}
            expanded={expanded}
            feature={feature}
            hovered={
              state.hovered === feature.id
                  // A collapsed folder stands in for whatever inside it is hovered.
                  || (!expanded && state.hoveredAncestors.has(feature.id))
            }
            selected={state.selected?.id === feature.id}
            visible={!state.hidden.has(feature.id)}
        />);
    if (feature.kind === 'folder' && expanded && item.children.length > 0) {
      rendered.push(
          <div className="border-gray-300 border-l ml-3" key={`children:${feature.id}`}>
            {rows(item.children, state, hidden)}
          </div>);
    }
  }
  return rendered;
}

function Row({dimmed, expanded, feature, hovered, selected, visible}: {
  dimmed: boolean;
  expanded: boolean;
  feature: EditableFeature;
  hovered: boolean;
  key: string;
  selected: boolean;
  visible: boolean;
}) {
  return (
    <div
        className={
          'cursor-pointer flex gap-1.5 h-7 items-center pl-1 pr-2 select-none '
              + (selected ? 'bg-blue-100 ' : hovered ? 'bg-gray-100 ' : '')
              + (dimmed ? 'opacity-50' : '')
        }
        data={{id: feature.id}}
        unboundEvents={{
          click: 'featureClicked',
          pointerenter: 'featureRowEntered',
          pointerleave: 'featureRowLeft',
        }}
    >
      {feature.kind === 'folder'
          ? <span
                className="cursor-pointer flex h-4 items-center justify-center shrink-0 w-4"
                data={{id: feature.id, role: 'toggle'}}
                unboundEvents={{click: 'folderToggled'}}
            >
              <Chevron expanded={expanded} />
            </span>
          : <span className="shrink-0 w-4" />
      }
      <FeatureIcon feature={feature} />
      <span
          className={
            'grow truncate '
                + (selected ? 'text-blue-900 ' : '')
                + (feature.data.name ? '' : 'italic text-gray-500')
          }
      >
        {feature.data.name || untitled(feature)}
      </span>
      <span
          ariaLabel={visible ? 'Hide' : 'Show'}
          className="cursor-pointer hover:text-gray-900 shrink-0 text-gray-500"
          data={{id: feature.id, role: 'toggle'}}
          title={visible ? 'Hide' : 'Show'}
          unboundEvents={{click: 'visibilityToggled'}}
      >
        <Eye visible={visible} />
      </span>
    </div>
  );
}

function FeatureIcon({feature}: {feature: EditableFeature}) {
  if (feature.kind === 'folder') {
    return (
      <svg
          className="h-4 shrink-0 stroke-current text-gray-600 w-4"
          fill="none"
          viewBox="0 0 16 16"
      >
        <FolderShape />
      </svg>
    );
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
    const color = feature.data.fill ?? DEFAULT_POINT_COLOR;
    return <PointMarker color={color} icon={feature.data.icon} />;
  }
}

// A box with a lid, for folders
function FolderShape() {
  return <path d="M2.5 5.5 H13.5 V13.5 H2.5 Z M1.5 2.5 H14.5 V5.5 H1.5 Z" strokeWidth="1.3" />;
}

/** Edits the selected feature. */
export function FeatureProperties({descendants, feature, folders}: {
  descendants: number;
  feature: EditableFeature;
  folders: Array<{folder: EditableFolder; depth: number}>;
}) {
  return (
    <div className="border-gray-300 border-t flex flex-col shrink-0">
      <div className="bg-gray-100 border-b border-gray-300 flex items-center px-2 py-1">
        <span className="font-bold grow">{`Editing ${feature.kind}`}</span>
        <Button
            ariaLabel="Center on map"
            className="hover:bg-black/10 p-1 rounded"
            title="Center on map"
            unboundEvents={{corgi: [[ACTION, 'centerClicked']]}}
        >
          <svg className="h-3 stroke-current w-3" fill="none" viewBox="0 0 12 12">
            <circle cx="6" cy="6" r="3.5" strokeWidth="1.3" />
            <path d="M6 0 V3 M6 9 V12 M0 6 H3 M9 6 H12" strokeWidth="1.3" />
          </svg>
        </Button>
        <Button
            ariaLabel="Deselect"
            className="hover:bg-black/10 p-1 rounded"
            title="Deselect"
            unboundEvents={{corgi: [[ACTION, 'deselectClicked']]}}
        >
          <svg className="h-3 stroke-current w-3" viewBox="0 0 12 12">
            <path d="M1 1 L11 11 M1 11 L11 1" strokeWidth="1.5" />
          </svg>
        </Button>
      </div>
      <div className="flex flex-col gap-2 p-2">
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
          {feature.kind === 'point'
              ? <button
                    ariaLabel="Icon"
                    className="
                        border
                        border-gray-300
                        flex
                        h-7
                        hover:bg-gray-100
                        items-center
                        justify-center
                        rounded
                        shrink-0
                        w-8
                    "
                    title="Icon"
                    unboundEvents={{click: 'iconButtonClicked'}}
                >
                  <PointMarker
                      color={feature.data.fill ?? DEFAULT_POINT_COLOR}
                      icon={feature.data.icon}
                  />
                </button>
              : ''
          }
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
