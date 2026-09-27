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
import { formatDistance, formatHeight, measureLine, profileStats } from './measurements';
import { LineProfile, LineProfileState } from './profile_chart';
import { Schema, USER_COLLECTION_SCHEMA } from './schema';
import { Data } from './workers/collection_loader';

export interface TreeItem {
  feature: EditableFeature;
  children: TreeItem[];
}

export interface OsmWayState {
  id: number;
  tags: {[key: string]: string}|'loading'|'failed';
}

export type InspectedObject = {
  data: Data;
  schema: Schema;
  // Set when the schema titles the object by its OpenStreetMap way
  osm: OsmWayState|undefined;
} & ({
  kind: 'line';
  // Measured along the tile's geometry, which is simplified for the zoom it loaded at
  lengthMeters: number;
  // Undefined until the elevations load, or if they fail
  climb: Climb|undefined;
}|{
  kind: 'polygon';
});

/** What the properties dialog shows, from the open collection or from a map layer. */
export type Subject = {
  source: 'feature';
  feature: EditableFeature;
  // Unset when the collection is read only
  editing: {
    // How many features deleting a folder takes with it
    descendants: number;
    folders: Array<{folder: EditableFolder; depth: number}>;
  }|undefined;
}|{
  source: 'object';
  object: InspectedObject;
};

interface Climb {
  upMeters: number;
  downMeters: number;
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
  // The folder a feature dragged in the list would drop into, where undefined is the root
  dropTarget: {folder: string|undefined}|undefined;
}

const WIDTHS_PX = [1, 2, 3, 4, 6, 8];
const EYE_OUTLINE =
    'M1.5 8 C3.5 4.5 5.5 3.5 8 3.5 C10.5 3.5 12.5 4.5 14.5 8 '
        + 'C12.5 11.5 10.5 12.5 8 12.5 C5.5 12.5 3.5 11.5 1.5 8 Z';

/** Lists the open collection's features as a tree. */
export function FeatureTree({readOnly, state}: {readOnly: boolean; state: FeatureListState}) {
  const rootTarget = state.dropTarget !== undefined && state.dropTarget.folder === undefined;
  // The bottom padding leaves somewhere to drop onto the root when every row is inside a folder.
  return (
    <div
        className={'pb-6 ' + (rootTarget ? 'bg-blue-50' : '')}
        unboundEvents={{
          dragleave: 'featureTreeDragLeft',
          dragover: 'featureTreeDraggedOver',
          drop: 'featureTreeDropped',
        }}
    >
      {state.tree.length > 0
          ? rows(state.tree, state, readOnly, /* dimmed= */ false)
          : [
            <div className="px-2 py-1 text-gray-500">
              This collection is empty
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
    items: TreeItem[], state: FeatureListState, readOnly: boolean, dimmed: boolean):
    corgi.VElementOrPrimitive[] {
  const rendered = [];
  for (const item of items) {
    const feature = item.feature;
    const expanded = state.expanded.has(feature.id);
    const hidden = dimmed || state.hidden.has(feature.id);
    rendered.push(
        <Row
            key={feature.id}
            dimmed={hidden}
            draggable={!readOnly}
            dropTarget={state.dropTarget?.folder === feature.id}
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
            {rows(item.children, state, readOnly, hidden)}
          </div>);
    }
  }
  return rendered;
}

function Row({dimmed, draggable, dropTarget, expanded, feature, hovered, selected, visible}: {
  dimmed: boolean;
  draggable: boolean;
  // Whether a feature dragged in the list would drop into this folder
  dropTarget: boolean;
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
              + (dropTarget
                  ? 'bg-blue-100 ring-1 ring-blue-400 ring-inset '
                  : selected ? 'bg-blue-100 ' : hovered ? 'bg-gray-100 ' : '')
              + (dimmed ? 'opacity-50' : '')
        }
        data={{id: feature.id}}
        draggable={draggable}
        unboundEvents={{
          click: 'featureClicked',
          dragend: 'featureDragEnded',
          dragover: 'featureDraggedOver',
          dragstart: 'featureDragStarted',
          drop: 'featureDropped',
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
        {feature.data.name || untitled(feature.kind)}
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

/**
 * Shows a feature of the open collection or an object from a map layer, with the controls to edit
 * it when editing is set.
 */
export function Properties({profile, subject}: {
  // Set for a line
  profile: LineProfileState|undefined;
  subject: Subject;
}) {
  const schema = subject.source === 'feature' ? USER_COLLECTION_SCHEMA : subject.object.schema;
  const kind = subject.source === 'feature' ? subject.feature.kind : subject.object.kind;
  const data: {[key: string]: boolean|number|string|undefined} =
      subject.source === 'feature' ? subject.feature.data : subject.object.data;
  const editing = subject.source === 'feature' ? subject.editing : undefined;
  const osm = subject.source === 'object' ? subject.object.osm : undefined;
  const title = data[schema.title.key];
  const description = schema.description ? data[schema.description] : undefined;
  const fields = schema.fields.flatMap(({key, label, values}): Array<[string, string]> => {
    const value = data[key];
    return value === undefined ? [] : [[label, values?.[String(value)] ?? String(value)]];
  });

  return (
    <PropertiesDialog title={`${editing ? 'Editing' : 'Viewing'} ${kind}`}>
      <div className="flex flex-col gap-2">
        {editing
            ? <Input
                  className="border border-gray-300 px-1 rounded"
                  forceValue={true}
                  placeholder={untitled(kind)}
                  value={title !== undefined ? String(title) : ''}
                  unboundEvents={{corgi: [[CHANGED, 'nameChanged']]}}
              />
            : osm
                ? <a
                      className="font-bold text-blue-700 underline"
                      href={`https://www.openstreetmap.org/way/${osm.id}`}
                      rel="noopener"
                      target="_blank"
                  >
                    {`OpenStreetMap way ${osm.id}`}
                  </a>
                : <div className="font-bold">{title ? String(title) : untitled(kind)}</div>
        }
        {editing && kind !== 'folder'
            ? <textarea
                  className="border border-gray-300 px-1 rounded"
                  placeholder="Description"
                  value={description !== undefined ? String(description) : ''}
                  unboundEvents={{input: 'descriptionChanged'}}
              />
            : !editing && description
                ? <div className="whitespace-pre-wrap">{String(description)}</div>
                : ''
        }
        {editing && subject.source === 'feature'
            ? <StyleControls feature={subject.feature} folders={editing.folders} />
            : ''
        }
        {subject.source === 'feature'
            ? <Stats feature={subject.feature} profile={profile} />
            : subject.object.kind === 'line'
                ? <LineStats
                      lengthMeters={subject.object.lengthMeters}
                      climb={subject.object.climb}
                  />
                : ''
        }
        {profile ? <LineProfile state={profile} /> : ''}
        {osm
            ? <OsmTags tags={osm.tags} />
            : fields.length > 0 ? <DataTable rows={fields} /> : ''
        }
        {editing
            ? <Button
                  className="bg-red-700 hover:bg-red-800 px-2 py-1 rounded self-start text-white"
                  unboundEvents={{corgi: [[ACTION, 'deleteClicked']]}}
              >
                {kind === 'folder' && editing.descendants > 0
                    ? `Delete folder and ${editing.descendants} ${
                        editing.descendants === 1 ? 'item' : 'items'}`
                    : 'Delete'}
              </Button>
            : ''
        }
      </div>
    </PropertiesDialog>
  );
}

function StyleControls({feature, folders}: {
  feature: EditableFeature;
  folders: Array<{folder: EditableFolder; depth: number}>;
}) {
  return (
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
  );
}

function OsmTags({tags}: {tags: OsmWayState['tags']}) {
  return tags === 'loading'
      ? <div className="text-gray-500">Loading tags</div>
      : tags === 'failed'
          ? <div className="text-gray-500">OpenStreetMap failed to return this way's tags</div>
          : <DataTable rows={Object.entries(tags).sort(([a], [b]) => a.localeCompare(b))} />;
}

function DataTable({rows}: {rows: Array<[string, string]>}) {
  if (rows.length === 0) {
    return <div className="text-gray-500">No data</div>;
  }

  return (
    <table className="w-full">
      <tbody>
        {rows.map(([key, value]) =>
            <tr className="align-top border-gray-200 border-t">
              <td className="pr-2 py-0.5 text-gray-600">{key}</td>
              <td className="break-all py-0.5">{value}</td>
            </tr>)}
      </tbody>
    </table>
  );
}

// Floats over the map, so its body scrolls rather than pushing past the bottom of the viewport.
function PropertiesDialog({children, title}: {
  children?: corgi.VElementOrPrimitive|corgi.VElementOrPrimitive[];
  title: string;
}) {
  return (
    <div className="
        bg-white
        flex
        flex-col
        min-h-0
        pointer-events-auto
        rounded
        shadow-lg
        text-gray-900
        text-sm
    ">
      <div className="border-b border-gray-300 flex items-center px-3 py-2">
        <span className="font-bold grow">{title}</span>
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
            ariaLabel="Close"
            className="hover:bg-black/10 p-1 rounded"
            title="Close"
            unboundEvents={{corgi: [[ACTION, 'deselectClicked']]}}
        >
          <svg className="h-3 stroke-current w-3" viewBox="0 0 12 12">
            <path d="M1 1 L11 11 M1 11 L11 1" strokeWidth="1.5" />
          </svg>
        </Button>
      </div>
      <div className="min-h-0 overflow-y-auto p-3">
        {children ?? []}
      </div>
    </div>
  );
}

// A line without elevations of its own takes its length and climb from the profile sampled for
// it, the way an object from a map layer does.
function Stats({feature, profile}: {
  feature: EditableFeature;
  profile: LineProfileState|undefined;
}) {
  if (feature.kind === 'line') {
    const stats = measureLine(feature.latLngE7, feature.elevationCentimeters);
    if (stats.elevation || profile?.status !== 'loaded') {
      return <LineStats lengthMeters={stats.lengthMeters} climb={stats.elevation} />;
    }
    const along = profile.distanceMeters;
    return (
      <LineStats lengthMeters={along[along.length - 1]} climb={profileStats(profile.meters)} />
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

export function LineStats({climb, lengthMeters}: {climb: Climb|undefined; lengthMeters: number}) {
  return (
    <div className="text-gray-700">
      {formatDistance(lengthMeters)}
      {climb
          ? `, ${formatHeight(climb.upMeters)} up, ${formatHeight(climb.downMeters)} down`
          : ''}
    </div>
  );
}

function untitled(kind: EditableFeature['kind']|'polygon'): string {
  return kind === 'polygon' ? 'Untitled area' : `Untitled ${kind}`;
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
