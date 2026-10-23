import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import * as corgi from 'external/dev_april_corgi+/js/corgi';

import { S2LatLng } from 'java/org/trailcatalog/s2';
import { Layer } from 'js/map/layer';

import { Chevron, Eye } from './feature_list';
import { Schema } from './schema';

export type LayerControl = {
  kind: 'checkbox';
  key: string;
  label: string;
  // Set for a setting, which reads as Off and On, rather than something the map shows, which has
  // an eye like a layer's
  setting?: boolean;
}|{
  // A yyyy-mm-dd day, where empty means unbounded
  kind: 'date';
  key: string;
  label: string;
}|{
  kind: 'percent';
  key: string;
  label: string;
}|{
  kind: 'select';
  key: string;
  label: string;
  options: Array<{value: string; label: string}>;
  // Whether the choice means anything with the other values, and disabled where it doesn't
  appliesTo?: (values: ControlValues) => boolean;
};

export type ControlValues = {[key: string]: boolean|number|string};

const CONTROL_TYPES = {
  checkbox: 'boolean',
  date: 'string',
  percent: 'number',
  select: 'string',
} as const satisfies Record<LayerControl['kind'], string>;

export interface LayerEntry {
  kind: 'layer';
  id: string;
  name: string;
  enabled: boolean;
  layer: Layer;
  // Set for a CollectionLayer, whose objects the properties dialog shows
  schema?: Schema;
  // Set for a layer of weather stations, so that the properties dialog can show a station's latest
  // METAR and TAF. Names the fields with its ICAO id and the reports it publishes, like "METAR,
  // TAF".
  weatherStation?: {id: string; reports: string};
  controls: LayerControl[];
  values: ControlValues;
  // Called with the new values whenever a control changes
  configure?: (values: ControlValues) => void;
  // Set for a layer whose pixels hold values, which a click shows under name. Read returns
  // undefined where the layer has no tile loaded.
  readout?: {name: string; read: (point: S2LatLng) => string|undefined};
  // Set for a layer with several things to say about a click, each a row after the readouts
  readings?: (point: S2LatLng) => Array<{name: string; value: string}>;
  // Set for a layer that shows the map's time, so the timeline shows while it's on. A forecast only
  // covers the times of its run, and the map leaves it out at any other time.
  timed?: 'any'|'forecast';
  onShown?: () => void;
  // Keys of values without a control that still save with the view state
  persisted?: string[];
  // Set for a forecast, as the first time after at in ms that it has a step for
  nextTime?: (at: number) => number|undefined;
}

export interface LayerGroup {
  kind: 'group';
  id: string;
  name: string;
  enabled: boolean;
  children: LayerNode[];
}

export type LayerNode = LayerEntry|LayerGroup;

export interface LayerTreeState {
  // Topmost first, the way they stack
  nodes: LayerNode[];
  // The groups and the layers with controls that are open
  expanded: ReadonlySet<string>;
}

/** Flattens the tree topmost first, with whether each layer and every group above it is on. */
export function layerEntries(nodes: LayerNode[], shown = true):
    Array<{entry: LayerEntry; shown: boolean}> {
  const entries = [];
  for (const node of nodes) {
    if (node.kind === 'group') {
      entries.push(...layerEntries(node.children, shown && node.enabled));
    } else {
      entries.push({entry: node, shown: shown && node.enabled});
    }
  }
  return entries;
}

/** Returns a copy of the tree with the node of the id replaced by what update makes of it. */
export function updateLayerNode(
    nodes: LayerNode[], id: string, update: (node: LayerNode) => LayerNode): LayerNode[] {
  return nodes.map(node => {
    if (node.id === id) {
      return update(node);
    } else if (node.kind === 'group') {
      return {...node, children: updateLayerNode(node.children, id, update)};
    } else {
      return node;
    }
  });
}

// What a node is set to, which for a group is only enabled
export interface LayerSetting {
  enabled: boolean;
  values: ControlValues;
}

// Keyed by node id. Only what differs from the defaults is kept, so that a default we change
// reaches the collections that never touched it.
export type LayerSettings = {[id: string]: Partial<LayerSetting>};

export function layerDefaultsOf(nodes: LayerNode[]): Map<string, LayerSetting> {
  const defaults = new Map<string, LayerSetting>();
  for (const node of nodes) {
    if (node.kind === 'group') {
      defaults.set(node.id, {enabled: node.enabled, values: {}});
      for (const [id, setting] of layerDefaultsOf(node.children)) {
        defaults.set(id, setting);
      }
    } else {
      defaults.set(node.id, {enabled: node.enabled, values: node.values});
    }
  }
  return defaults;
}

/** Lists where the tree differs from the defaults. */
export function diffLayerSettings(
    nodes: LayerNode[], defaults: ReadonlyMap<string, LayerSetting>): LayerSettings {
  const settings: LayerSettings = {};
  for (const node of nodes) {
    const original = checkExists(defaults.get(node.id));
    const setting: Partial<LayerSetting> = {};
    if (node.enabled !== original.enabled) {
      setting.enabled = node.enabled;
    }
    if (node.kind === 'group') {
      Object.assign(settings, diffLayerSettings(node.children, defaults));
    } else {
      const values: ControlValues = {};
      for (const [key, value] of Object.entries(node.values)) {
        if (value !== original.values[key]) {
          values[key] = value;
        }
      }
      if (Object.keys(values).length > 0) {
        setting.values = values;
      }
    }
    if (Object.keys(setting).length > 0) {
      settings[node.id] = setting;
    }
  }
  return settings;
}

/**
 * Returns the tree set to the defaults with the settings on top. A node whose setting is unchanged
 * is returned as is.
 *
 * Settings for ids and keys the tree doesn't have, or of the wrong type, are dropped because an
 * older client saved them.
 */
export function applyLayerSettings(
    nodes: LayerNode[],
    defaults: ReadonlyMap<string, LayerSetting>,
    settings: LayerSettings): LayerNode[] {
  return nodes.map(node => {
    const original = checkExists(defaults.get(node.id));
    const setting = settings[node.id] ?? {};
    const enabled = typeof setting.enabled === 'boolean' ? setting.enabled : original.enabled;
    if (node.kind === 'group') {
      const children = applyLayerSettings(node.children, defaults, settings);
      const same =
          enabled === node.enabled && children.every((child, i) => child === node.children[i]);
      return same ? node : {...node, enabled, children};
    }

    const values = {...original.values};
    for (const key of node.persisted ?? []) {
      const value = setting.values?.[key];
      if (typeof value === 'string') {
        values[key] = value;
      }
    }
    for (const control of node.controls) {
      const value = setting.values?.[control.key];
      // A saved choice may name an option that no longer exists.
      const known =
          control.kind !== 'select' || control.options.some(option => option.value === value);
      if (typeof value === CONTROL_TYPES[control.kind] && known) {
        values[control.key] = value as boolean|number|string;
      }
    }
    const sameValues = Object.entries(values).every(([key, value]) => node.values[key] === value);
    if (enabled === node.enabled && sameValues) {
      return node;
    }
    return {...node, enabled, values: sameValues ? node.values : values};
  });
}

export function findLayerNode(nodes: LayerNode[], id: string): LayerNode|undefined {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    } else if (node.kind === 'group') {
      const found = findLayerNode(node.children, id);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

/** Lists the map's layers in their groups, the way FeatureTree lists folders. */
export function LayerTree({state}: {state: LayerTreeState}) {
  return <div>{layerRows(state.nodes, state.expanded, /* dimmed= */ false)}</div>;
}

function layerRows(nodes: LayerNode[], expanded: ReadonlySet<string>, dimmed: boolean):
    corgi.VElementOrPrimitive[] {
  const rendered = [];
  for (const node of nodes) {
    const open = expanded.has(node.id);
    const hidden = dimmed || !node.enabled;
    const expandable = node.kind === 'group' || node.controls.length > 0;
    rendered.push(
        <LayerRow
            key={node.id}
            dimmed={hidden}
            expandable={expandable}
            expanded={open}
            node={node}
        />);
    if (!open || !expandable) {
      continue;
    }

    rendered.push(
        <div className="border-gray-300 border-l ml-3" key={`children:${node.id}`}>
          {node.kind === 'group'
              ? layerRows(node.children, expanded, hidden)
              : [<LayerControls entry={node} dimmed={hidden} />]
          }
        </div>);
  }
  return rendered;
}

function LayerRow({dimmed, expandable, expanded, node}: {
  dimmed: boolean;
  expandable: boolean;
  expanded: boolean;
  key: string;
  node: LayerNode;
}) {
  return (
    <div
        className={
          'cursor-pointer flex gap-1.5 h-7 hover:bg-gray-100 items-center pl-1 pr-2 select-none '
              + (node.kind === 'group' ? 'font-medium ' : '')
              + (dimmed ? 'opacity-50' : '')
        }
        data={{id: node.id}}
        unboundEvents={{click: 'layerRowClicked'}}
    >
      {expandable
          ? <span
                className="cursor-pointer flex h-4 items-center justify-center shrink-0 w-4"
                data={{id: node.id, role: 'toggle'}}
                unboundEvents={{click: 'layerExpandToggled'}}
            >
              <Chevron expanded={expanded} />
            </span>
          : <span className="shrink-0 w-4" />
      }
      <span className="grow truncate">{node.name}</span>
      <span
          ariaLabel={node.enabled ? 'Hide' : 'Show'}
          className="cursor-pointer hover:text-gray-900 shrink-0 text-gray-500"
          data={{id: node.id, role: 'toggle'}}
          title={node.enabled ? 'Hide' : 'Show'}
          unboundEvents={{click: 'layerVisibilityToggled'}}
      >
        <Eye visible={node.enabled} />
      </span>
    </div>
  );
}

function LayerControls({dimmed, entry}: {dimmed: boolean; entry: LayerEntry}) {
  return (
    <div className={'flex flex-col gap-1 pb-1 pl-6 pr-2 pt-0.5 ' + (dimmed ? 'opacity-50' : '')}>
      {entry.controls.map(control => {
        const value = entry.values[control.key];
        const data = {id: entry.id, key: control.key};
        if (control.kind === 'checkbox' && !control.setting) {
          const visible = value === true;
          return (
            <div
                className={
                  'cursor-pointer flex gap-1.5 group hover:bg-gray-100 items-center select-none'
                }
                data={{...data, on: String(!visible)}}
                title={visible ? 'Hide' : 'Show'}
                unboundEvents={{click: 'layerControlChanged'}}
            >
              <span className={'grow ' + (visible ? 'text-gray-700' : 'text-gray-400')}>
                {control.label}
              </span>
              <span
                  ariaLabel={visible ? 'Hide' : 'Show'}
                  className="group-hover:text-gray-900 shrink-0 text-gray-500"
              >
                <Eye visible={visible} />
              </span>
            </div>
          );
        } else if (control.kind === 'checkbox') {
          // Off and On after the label, so that its value lines up on the right like a select's
          return (
            <div className="flex gap-1.5 items-center">
              <span className="grow text-gray-700">{control.label}</span>
              <div
                  className="bg-gray-100 border border-gray-300 flex overflow-hidden rounded shrink-0"
              >
                {[false, true].map(on =>
                    <button
                        className={
                          // 18 px and the border make it as tall as a select
                          'leading-[18px] px-2 '
                              + (on === (value === true)
                                  ? 'bg-gray-900 text-white'
                                  : 'hover:bg-gray-200 text-gray-700')
                        }
                        data={{...data, on: String(on)}}
                        unboundEvents={{click: 'layerControlChanged'}}
                    >
                      {on ? 'On' : 'Off'}
                    </button>
                )}
              </div>
            </div>
          );
        } else if (control.kind === 'select') {
          return (
            <label className="flex gap-1.5 items-center">
              <span className="grow text-gray-700">{control.label}</span>
              <select
                  className="border border-gray-300 disabled:opacity-50 min-w-0 px-1 rounded"
                  data={data}
                  disabled={control.appliesTo?.(entry.values) === false}
                  unboundEvents={{change: 'layerControlChanged'}}
              >
                {control.options.map(option =>
                    <option selected={option.value === value || undefined} value={option.value}>
                      {option.label}
                    </option>
                )}
              </select>
            </label>
          );
        } else if (control.kind === 'date') {
          return (
            <label className="flex gap-1.5 items-center">
              <span className="text-gray-700 w-12">{control.label}</span>
              <input
                  className="border border-gray-300 grow min-w-0 px-1 rounded"
                  data={data}
                  type="date"
                  value={String(value)}
                  unboundEvents={{change: 'layerControlChanged'}}
              />
            </label>
          );
        } else {
          return (
            <label className="flex gap-1.5 items-center">
              <span className="grow text-gray-700">{control.label}</span>
              <input
                  className="border border-gray-300 px-1 rounded w-14"
                  data={data}
                  max="100"
                  min="0"
                  step="1"
                  type="number"
                  value={String(value)}
                  unboundEvents={{change: 'layerControlChanged'}}
              />
              <span className="text-gray-700">%</span>
            </label>
          );
        }
      })}
    </div>
  );
}
