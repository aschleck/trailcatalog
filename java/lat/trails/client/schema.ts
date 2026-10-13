// What the keys of a collection's feature data mean, so that the properties dialog can show them.
export interface Schema {
  title: {kind: 'text'; key: string}
      // The key holds an OpenStreetMap way id, or a point id that came from a node or a way, and
      // we fetch that element's tags
      |{kind: 'osm_point'; key: string}
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

// See EuropeanDesignatedAreas.kt
export const EUROPEAN_DESIGNATED_AREAS_SCHEMA: Schema = {
  title: {kind: 'text', key: 'name'},
  description: undefined,
  fields: [
    {key: 'designation', label: 'Designation'},
    {
      key: 'iucn',
      label: 'IUCN category',
      values: {
        'Ia': 'Ia Strict nature reserve',
        'Ib': 'Ib Wilderness area',
        'II': 'II National park',
        'III': 'III Natural monument',
        'IV': 'IV Habitat or species management area',
        'V': 'V Protected landscape',
        'VI': 'VI Protected area with sustainable use',
      },
    },
    {key: 'designated', label: 'Designated'},
    {key: 'country', label: 'Country'},
  ],
};

// See JapanNationalParks.kt
export const JAPAN_NATIONAL_PARKS_SCHEMA: Schema = {
  title: {kind: 'text', key: 'name'},
  description: undefined,
  fields: [
    {key: 'zone', label: 'Zone'},
  ],
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

// The type key is a PointCategory, which the element's own tags say better.
export const OSM_NODES_SCHEMA: Schema = {
  title: {kind: 'osm_point', key: 'id'},
  description: undefined,
  fields: [],
};
