// What the keys of a collection's feature data mean, so that the properties dialog can show them.
export interface Schema {
  title: {kind: 'text'; key: string}
      // The key holds an OpenStreetMap node or way id, whose tags we fetch from OpenStreetMap
      |{kind: 'osm_node'; key: string}
      |{kind: 'osm_way'; key: string};
  description: string|undefined;
  // Shown in this order after the stats, skipping any the feature lacks
  fields: Field[];
}

interface Field {
  key: string;
  label: string;
  // How to show raw values, which pass through unchanged when missing
  values?: {[raw: string]: string};
}

// Every other key is style or structure, which the editing controls already show.
export const USER_COLLECTION_SCHEMA: Schema = {
  title: {kind: 'text', key: 'name'},
  description: 'description',
  fields: [],
};

// See PublicAccess.kt, which writes owner as a label and access as PAD-US's code.
export const PUBLIC_LAND_SCHEMA: Schema = {
  title: {kind: 'text', key: 'name'},
  description: undefined,
  fields: [
    {key: 'owner', label: 'Owner'},
    {
      key: 'access',
      label: 'Access',
      values: {
        'OA': 'Open',
        'RA': 'Restricted',
      },
    },
  ],
};

// The type key is a WayCategory, which the way's own tags say better.
export const OSM_WAYS_SCHEMA: Schema = {
  title: {kind: 'osm_way', key: 'id'},
  description: undefined,
  fields: [],
};

// The type key is a PointCategory, which the node's own tags say better.
export const OSM_NODES_SCHEMA: Schema = {
  title: {kind: 'osm_node', key: 'id'},
  description: undefined,
  fields: [],
};
