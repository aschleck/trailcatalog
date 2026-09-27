import * as corgi from 'external/dev_april_corgi+/js/corgi';

import { Layer } from 'js/map/layer';

import { Chevron, Eye } from './feature_list';
import { Schema } from './schema';

export type LayerControl = {
  kind: 'checkbox';
  key: string;
  label: string;
}|{
  // A yyyy-mm-dd day, where empty means unbounded
  kind: 'date';
  key: string;
  label: string;
}|{
  kind: 'percent';
  key: string;
  label: string;
};

export type ControlValues = {[key: string]: boolean|number|string};

export interface LayerEntry {
  kind: 'layer';
  id: string;
  name: string;
  enabled: boolean;
  layer: Layer;
  // Set for a CollectionLayer, whose objects the properties dialog shows
  schema?: Schema;
  controls: LayerControl[];
  values: ControlValues;
  // Called with the new values whenever a control changes
  configure?: (values: ControlValues) => void;
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

/** Sorts every level of the tree with groups first and then by name, the way buildTree does. */
export function sortLayerNodes(nodes: LayerNode[]): LayerNode[] {
  return nodes
      .map(node =>
          node.kind === 'group' ? {...node, children: sortLayerNodes(node.children)} : node)
      .sort((a, b) => {
        if (a.kind !== b.kind) {
          return a.kind === 'group' ? -1 : 1;
        }
        return a.name.localeCompare(b.name, undefined, {numeric: true});
      });
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
        if (control.kind === 'checkbox') {
          return (
            <label className="cursor-pointer flex gap-1.5 items-center select-none">
              <input
                  checked={value === true}
                  data={data}
                  type="checkbox"
                  unboundEvents={{change: 'layerControlChanged'}}
              />
              <span>{control.label}</span>
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
