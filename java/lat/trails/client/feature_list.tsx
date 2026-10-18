import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { Button } from 'external/dev_april_corgi+/js/emu/button';
import { ACTION, CHANGED } from 'external/dev_april_corgi+/js/emu/events';
import { Input } from 'external/dev_april_corgi+/js/emu/input';
import { Select } from 'external/dev_april_corgi+/js/emu/select';

import { EditableFeature, EditableFolder } from './features';
import { DangerButton, PanelButton, PanelCloseButton } from './controls';
import { FIELD_EDITED, FIELD_ICON_CLICKED } from './events';
import { FieldInput } from './field_input';
import { PointMarker } from './icon_picker';
import {
  formatArea,
  formatDistance,
  formatHeight,
  measureLine,
  pathLengthMeters,
  profileStats,
  ringAreaMeters2,
} from './measurements';
import { LineProfile, LineProfileState } from './profile_chart';
import {
  fieldsFor,
  formatField,
  getFieldKind,
  getTitle,
  Schema,
  titleField,
} from './schema';
import { Data } from './workers/collection_loader';
import {
  CollectionSchema,
  DEFAULT_COLOR,
  FieldDefinition,
  getLineKind,
  lineLook,
  pointLook,
  polygonLook,
} from './workers/collection_schema';

export interface TreeItem {
  feature: EditableFeature;
  children: TreeItem[];
}

export interface OsmElementState {
  type: 'node'|'way';
  id: number;
  tags: {[key: string]: string}|'loading'|'failed';
}

export type InspectedObject = {
  data: Data;
  schema: Schema;
  // Set when the schema titles the object by its OpenStreetMap node or way
  osm: OsmElementState|undefined;
} & ({
  kind: 'line';
  // Measured along the tile's geometry, which is simplified for the zoom it loaded at
  lengthMeters: number;
  // Undefined until the elevations load, or if they fail
  climb: Climb|undefined;
}|{
  kind: 'point';
  latDegrees: number;
  lngDegrees: number;
}|{
  kind: 'polygon';
});

/** What the properties dialog shows, from the open collection or from a map layer. */
export type Subject = {
  source: 'feature';
  feature: EditableFeature;
  schema: CollectionSchema;
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
  // Copies of every feature in the open collection, which buildTree arranges into folders
  all: EditableFeature[];
  // The open collection's, which says what each feature's fields are and how it draws
  schema: CollectionSchema;
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

export type CollectionStatus = 'failed'|'loaded'|'loading';

const EYE_OUTLINE =
    'M1.5 8 C3.5 4.5 5.5 3.5 8 3.5 C10.5 3.5 12.5 4.5 14.5 8 '
        + 'C12.5 11.5 10.5 12.5 8 12.5 C5.5 12.5 3.5 11.5 1.5 8 Z';

/** Lists the open collection's features as a tree. */
export function FeatureTree({readOnly, state, status, tree}: {
  readOnly: boolean;
  state: FeatureListState;
  status: CollectionStatus;
  // buildTree of state.all
  tree: TreeItem[];
}) {
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
      {tree.length > 0
          ? rows(tree, state, readOnly, /* dimmed= */ false)
          : [
            <div className="px-2 py-1 text-gray-500">
              {status === 'loading'
                  ? 'Loading features...'
                  : status === 'failed'
                      ? 'Couldn\'t load this collection'
                      : 'This collection is empty'
              }
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

export function Chevron({expanded}: {expanded: boolean}) {
  return (
    <svg className="h-3 shrink-0 stroke-current text-gray-500 w-3" fill="none" viewBox="0 0 16 16">
      <path d={expanded ? 'M3 6 L8 11 L13 6' : 'M6 3 L11 8 L6 13'} strokeWidth="2" />
    </svg>
  );
}

export function Eye({visible}: {visible: boolean}) {
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
            schema={state.schema}
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

function Row(
    {dimmed, draggable, dropTarget, expanded, feature, hovered, schema, selected, visible}: {
  dimmed: boolean;
  draggable: boolean;
  // Whether a feature dragged in the list would drop into this folder
  dropTarget: boolean;
  expanded: boolean;
  feature: EditableFeature;
  hovered: boolean;
  key: string;
  schema: CollectionSchema;
  selected: boolean;
  visible: boolean;
}) {
  const title = getTitle(schema, feature);
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
      <FeatureIcon feature={feature} schema={schema} />
      <span
          className={
            'grow truncate '
                + (selected ? 'text-blue-900 ' : '')
                + (title ? '' : 'italic text-gray-500')
          }
      >
        {title || untitled(getFieldKind(feature))}
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

export function FeatureIcon(
    {feature, schema}: {feature: EditableFeature; schema: CollectionSchema}) {
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
            d={
              getLineKind(feature.data) === 'drawing'
                  ? 'M2 11 C4 5 6 13 9 8 S12 4 14 6'
                  : 'M2 12 L6 6 L10 10 L14 4'
            }
            fill="none"
            stroke={lineLook(schema, feature.data)?.stroke ?? DEFAULT_COLOR}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
        />
      </svg>
    );
  } else if (feature.kind === 'polygon') {
    const look = polygonLook(schema, feature.data);
    return (
      <svg className="h-4 shrink-0 w-4" viewBox="0 0 16 16">
        <path
            d="M3 4 L12 2.5 L13.5 12 L4 13.5 Z"
            fill={look?.fill ?? DEFAULT_COLOR}
            stroke={look?.stroke ?? DEFAULT_COLOR}
            strokeLinejoin="round"
            strokeWidth="1.5"
        />
      </svg>
    );
  } else {
    const look = pointLook(schema, feature.data);
    return <PointMarker color={look?.fill ?? DEFAULT_COLOR} icon={look?.icon} />;
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
  const kind = subject.source === 'feature' ? subject.feature.kind : subject.object.kind;
  const name = subject.source === 'feature' ? getFieldKind(subject.feature) : kind;
  const editing = subject.source === 'feature' ? subject.editing : undefined;
  const osm = subject.source === 'object' ? subject.object.osm : undefined;
  const {title, paragraphs, fields} =
      subject.source === 'feature'
          ? featureText(subject.schema, subject.feature)
          : objectText(subject.object.schema, subject.object.data);

  return (
    <PropertiesDialog title={`${editing ? 'Editing' : 'Viewing'} ${name}`}>
      <div className="flex flex-col gap-2">
        {editing
            // A folder has no fields, so its name gets a box of its own.
            ? kind === 'folder'
                ? <Input
                      className="border border-gray-300 h-7 px-1 rounded"
                      forceValue={true}
                      placeholder={untitled(name)}
                      value={title ?? ''}
                      unboundEvents={{corgi: [[CHANGED, 'nameChanged']]}}
                  />
                : ''
            : osm
                ? <a
                      className="font-bold text-blue-700 underline"
                      href={`https://www.openstreetmap.org/${osm.type}/${osm.id}`}
                      rel="noopener"
                      target="_blank"
                  >
                    {`OpenStreetMap ${osm.type} ${osm.id}`}
                  </a>
                : <div className="font-bold">{title || untitled(name)}</div>
        }
        {editing
            ? ''
            : paragraphs.map(text => <div className="whitespace-pre-wrap">{text}</div>)
        }
        {editing && subject.source === 'feature'
            ? <FieldControls
                  feature={subject.feature}
                  folders={editing.folders}
                  schema={subject.schema}
              />
            : ''
        }
        {subject.source === 'feature'
            ? <Stats feature={subject.feature} profile={profile} />
            : subject.object.kind === 'line'
                ? <LineStats
                      climb={subject.object.climb}
                      lengthMeters={subject.object.lengthMeters}
                  />
                : subject.object.kind === 'point'
                    ? <div className="text-gray-700">
                        {`${subject.object.latDegrees.toFixed(5)}, `
                            + subject.object.lngDegrees.toFixed(5)}
                      </div>
                    : ''
        }
        {profile ? <LineProfile state={profile} /> : ''}
        {osm
            ? <OsmTags tags={osm.tags} />
            : fields.length > 0 && !editing ? <DataTable rows={fields} /> : ''
        }
        {editing
            ? <DangerButton
                  className="self-start"
                  unboundEvents={{corgi: [[ACTION, 'deleteClicked']]}}
              >
                {kind === 'folder' && editing.descendants > 0
                    ? `Delete folder and ${editing.descendants} ${
                        editing.descendants === 1 ? 'item' : 'items'}`
                    : 'Delete'}
              </DangerButton>
            : ''
        }
      </div>
    </PropertiesDialog>
  );
}

// How the editor lays out a run of fields. Labeled fields line up in a grid, unlabeled text and
// dates take a row of their own, and the other unlabeled fields share a row.
type FieldBlock =
    {kind: 'inline'; fields: FieldDefinition[]}
    |{kind: 'labeled'; fields: FieldDefinition[]}
    |{kind: 'wide'; field: FieldDefinition};

function blocksOf(fields: FieldDefinition[]): FieldBlock[] {
  const blocks: FieldBlock[] = [];
  for (const field of fields) {
    const last = blocks[blocks.length - 1];
    const kind =
        !field.hideLabel ? 'labeled'
            : field.type === 'date' || field.type === 'text' ? 'wide'
            : 'inline';
    if (kind === 'wide') {
      blocks.push({kind, field});
    } else if (last?.kind === kind) {
      last.fields.push(field);
    } else {
      blocks.push({kind, fields: [field]});
    }
  }
  return blocks;
}

// The schema's fields in order, and then the folder picker, which lays out like an unlabeled field
// so it joins a trailing row of them
function FieldControls({feature, folders, schema}: {
  feature: EditableFeature;
  folders: Array<{folder: EditableFolder; depth: number}>;
  schema: CollectionSchema;
}) {
  const blocks = blocksOf(fieldsFor(schema, getFieldKind(feature)));
  const joined = blocks[blocks.length - 1]?.kind === 'inline';
  const iconColor =
      (feature.kind === 'point' ? pointLook(schema, feature.data)?.fill : undefined)
          ?? DEFAULT_COLOR;
  const input = (field: FieldDefinition, compact: boolean) =>
      <FieldInput
          key={`${feature.id}:${field.id}`}
          compact={compact}
          field={field}
          iconColor={iconColor}
          values={feature.data}
          unboundEvents={{
            corgi: [
              [FIELD_EDITED, 'fieldEdited'],
              [FIELD_ICON_CLICKED, 'fieldIconClicked'],
            ],
          }}
      />;
  const folder =
      <Select
          ariaLabel="Folder"
          className="border border-gray-300 grow h-7 min-w-0 rounded"
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
      />;
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, i) =>
          block.kind === 'inline'
              ? <div className="flex flex-wrap gap-2 items-center">
                  {block.fields.map(field => input(field, /* compact= */ true))}
                  {joined && i === blocks.length - 1 ? folder : ''}
                </div>
              : block.kind === 'labeled'
                  ? <div className="gap-x-2 gap-y-1 grid grid-cols-[auto_1fr] items-center">
                      {block.fields.flatMap(field => [
                        <span className="text-gray-600 whitespace-nowrap">{field.label}</span>,
                        input(field, /* compact= */ false),
                      ])}
                    </div>
                  : input(block.field, /* compact= */ false))}
      {joined ? '' : folder}
    </div>
  );
}

interface ReadOnlyText {
  title: string|undefined;
  // Long text, which would only crowd the table
  paragraphs: string[];
  fields: Array<[string, string]>;
}

// How each field with a value reads, for a feature somebody can only view. The field the title
// comes from is left out, since the title already shows it.
function featureText(schema: CollectionSchema, feature: EditableFeature): ReadOnlyText {
  const text: ReadOnlyText = {title: getTitle(schema, feature), paragraphs: [], fields: []};
  const titled = titleField(schema, feature);
  for (const field of fieldsFor(schema, getFieldKind(feature))) {
    const value = feature.data[field.id];
    if (value === undefined || field.id === titled) {
      continue;
    } else if (field.type === 'text' && field.multiline) {
      text.paragraphs.push(String(value));
      continue;
    }
    text.fields.push([field.label, formatField(field, value)]);
  }
  return text;
}

function objectText(schema: Schema, data: Data): ReadOnlyText {
  const title = data[schema.title.key];
  const description = schema.description ? data[schema.description] : undefined;
  return {
    title: title !== undefined ? String(title) : undefined,
    paragraphs: description !== undefined ? [String(description)] : [],
    fields: schema.fields.flatMap(({key, label, values}): Array<[string, string]> => {
      const value = data[key];
      return value === undefined ? [] : [[label, values?.[String(value)] ?? String(value)]];
    }),
  };
}

function OsmTags({tags}: {tags: OsmElementState['tags']}) {
  return tags === 'loading'
      ? <div className="text-gray-500">Loading tags</div>
      : tags === 'failed'
          ? <div className="text-gray-500">Failed to load tags</div>
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
      <div className="border-b border-gray-300 flex gap-2 items-center p-3">
        <span className="font-bold grow">{title}</span>
        <PanelButton label="Center on map" unboundEvents={{corgi: [[ACTION, 'centerClicked']]}}>
          <circle cx="10" cy="10" r="5" strokeWidth="1.5" />
          <path d="M10 2 V5 M10 15 V18 M2 10 H5 M15 10 H18" strokeWidth="1.5" />
        </PanelButton>
        <PanelCloseButton unboundEvents={{corgi: [[ACTION, 'deselectClicked']]}} />
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
  if (feature.kind === 'line' && getLineKind(feature.data) === 'drawing') {
    return <div className="hidden" />;
  } else if (feature.kind === 'line') {
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
  } else if (feature.kind === 'polygon') {
    const ring = Array.from(feature.latLngE7, e7 => e7 / 1e7);
    // The perimeter runs back to the first vertex.
    const perimeter = pathLengthMeters([...ring, ring[0], ring[1]]);
    return (
      <div className="text-gray-700">
        {`${formatArea(ringAreaMeters2(ring))}, ${formatDistance(perimeter)} around`}
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

export function untitled(kind: string): string {
  return kind === 'polygon' ? 'Untitled area' : `Untitled ${kind}`;
}

/** Sorts folders ahead of everything else and titles in the order a person would number them. */
export function buildTree(features: Iterable<EditableFeature>, schema: CollectionSchema):
    TreeItem[] {
  const children = new Map<string|undefined, TreeItem[]>();
  const items = new Map<string, TreeItem>();
  for (const feature of features) {
    items.set(feature.id, {feature, children: []});
  }
  for (const item of items.values()) {
    // Keep in sync with FeatureStore#parentOf
    const folder = item.feature.data.folder_id;
    const parent =
        folder !== undefined && items.get(folder)?.feature.kind === 'folder' ? folder : undefined;
    const siblings = children.get(parent) ?? [];
    siblings.push(item);
    children.set(parent, siblings);
  }
  for (const item of items.values()) {
    item.children = sortItems(children.get(item.feature.id) ?? [], schema);
  }
  return sortItems(children.get(undefined) ?? [], schema);
}

/** Flattens a tree's folders in order with their depth, skipping excluded and what's in it. */
export function foldersOf(tree: TreeItem[], excluded: string|undefined, depth = 0):
    Array<{folder: EditableFolder; depth: number}> {
  const folders = [];
  for (const item of tree) {
    if (item.feature.kind === 'folder' && item.feature.id !== excluded) {
      folders.push({folder: item.feature, depth});
      folders.push(...foldersOf(item.children, excluded, depth + 1));
    }
  }
  return folders;
}

/** Returns the shown folders not inside another folder, which start open. */
export function topLevelFolderIds(
    features: Iterable<EditableFeature>, schema: CollectionSchema, hidden: ReadonlySet<string>):
    string[] {
  return buildTree(features, schema)
      .filter(i => i.feature.kind === 'folder' && !hidden.has(i.feature.id))
      .map(i => i.feature.id);
}

function sortItems(items: TreeItem[], schema: CollectionSchema): TreeItem[] {
  return items.sort((a, b) => {
    const aFolder = a.feature.kind === 'folder';
    const bFolder = b.feature.kind === 'folder';
    if (aFolder !== bFolder) {
      return aFolder ? -1 : 1;
    }
    return (getTitle(schema, a.feature) ?? '').localeCompare(
        getTitle(schema, b.feature) ?? '', undefined, {numeric: true});
  });
}
