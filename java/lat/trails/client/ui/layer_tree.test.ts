import { Layer } from 'js/map/layer';

import {
  applyLayerSettings,
  diffLayerSettings,
  findLayerNode,
  LayerEntry,
  layerDefaultsOf,
  LayerNode,
} from './layer_tree';

test('keeps only what differs from the defaults', () => {
  const defaults = layerDefaultsOf(tree());
  const nodes = applyLayerSettings(tree(), defaults, {
    'osm': {enabled: false},
    'osm/nodes': {values: {safety: false}},
  });

  expect(diffLayerSettings(nodes, defaults)).toEqual({
    'osm': {enabled: false},
    'osm/nodes': {values: {safety: false}},
  });
  expect(diffLayerSettings(tree(), defaults)).toEqual({});
});

test('drops ids, keys, and types the tree does not have', () => {
  const defaults = layerDefaultsOf(tree());
  const nodes = applyLayerSettings(tree(), defaults, {
    'gone': {enabled: false},
    'osm/nodes': {enabled: false, values: {gone: false, safety: 'no', water: false}},
  });

  expect(diffLayerSettings(nodes, defaults)).toEqual({
    'osm/nodes': {enabled: false, values: {water: false}},
  });
});

test('resets what the settings leave out and keeps unchanged nodes', () => {
  const defaults = layerDefaultsOf(tree());
  const changed = applyLayerSettings(tree(), defaults, {'osm/nodes': {values: {safety: false}}});
  const reset = applyLayerSettings(changed, defaults, {});

  expect((findLayerNode(reset, 'osm/nodes') as LayerEntry).values.safety).toBe(true);
  expect(findLayerNode(reset, 'osm/ways')).toBe(findLayerNode(changed, 'osm/ways'));
});

test('restores persisted values that have no control', () => {
  const defaults = layerDefaultsOf(tree());
  const nodes =
      applyLayerSettings(tree(), defaults, {'osm/ways': {values: {pin: '45,7', other: '1,2'}}});

  expect((findLayerNode(nodes, 'osm/ways') as LayerEntry).values).toEqual({pin: '45,7'});
  expect(diffLayerSettings(nodes, defaults)).toEqual({'osm/ways': {values: {pin: '45,7'}}});
});

function tree(): LayerNode[] {
  return [{
    kind: 'group',
    id: 'osm',
    name: 'OpenStreetMap',
    enabled: true,
    children: [{
      kind: 'layer',
      id: 'osm/nodes',
      name: 'Nodes',
      enabled: true,
      layer: {} as Layer,
      controls: [
        {kind: 'checkbox', key: 'safety', label: 'Safety'},
        {kind: 'checkbox', key: 'water', label: 'Water'},
      ],
      values: {safety: true, water: true},
    }, {
      kind: 'layer',
      id: 'osm/ways',
      name: 'Ways',
      enabled: true,
      layer: {} as Layer,
      controls: [],
      values: {},
      persisted: ['pin'],
    }],
  }];
}
