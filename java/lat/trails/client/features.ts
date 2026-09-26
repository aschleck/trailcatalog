import { MessageInitShape } from '@bufbuild/protobuf';

import {
  FeatureKind,
  Folder,
  Line,
  Point,
  WriteSchema,
} from 'trails_lat/proto/data_pb';

// The jsonb every feature carries. Colors are #rrggbb.
export interface FeatureData {
  name?: string;
  description?: string;
  folder_id?: string;
  icon?: string;
  fill?: string;
  stroke?: string;
  width_px?: number;
  [key: string]: boolean|number|string|undefined;
}

interface FeatureBase {
  id: string;
  // The collection version this feature was last saved at (or 0 if unsaved)
  version: bigint;
  data: FeatureData;
}

export interface EditableFolder extends FeatureBase {
  kind: 'folder';
}

// Geometry arrays are replaced rather than written through, because undo holds on to them.
export interface EditableLine extends FeatureBase {
  kind: 'line';
  latLngE7: Int32Array;
  elevationCentimeters: Int32Array|undefined;
  timeSeconds: BigInt64Array|undefined;
}

export interface EditablePoint extends FeatureBase {
  kind: 'point';
  latE7: number;
  lngE7: number;
  elevationCentimeters: number|undefined;
}

export type EditableFeature = EditableFolder|EditableLine|EditablePoint;

export type SaveOp = 'delete'|'put';

export const DEFAULT_LINE_COLOR = '#de29db';
export const DEFAULT_POINT_COLOR = '#de29db';
export const DEFAULT_WIDTH_PX = 3;

// What a point without an icon of its own is drawn as
export const DEFAULT_ICON = '⬤';
// The default dot is solid ink, so at the size of the outlined emoji it outweighs them.
export const DEFAULT_ICON_SHRINK = 0.6;

/**
 * Returns the glyph a point is drawn as. Plain ASCII is a symbol name from whatever tool wrote the
 * file, like "point", rather than something to draw, so it gets the default too.
 */
export function pointIcon(icon: string|undefined): string {
  return importableIcon(icon) ?? DEFAULT_ICON;
}

/** Returns the icon worth keeping from an imported symbol, see pointIcon. */
export function importableIcon(icon: string|undefined): string|undefined {
  return icon && !/^[\x00-\x7F]*$/.test(icon) ? icon : undefined;
}

/** Copies a feature so that later edits to the original leave the copy alone. */
export function snapshot<F extends EditableFeature>(feature: F): F {
  return {...feature, data: {...feature.data}};
}

export function folderFromProto(folder: Folder): EditableFolder {
  return {
    kind: 'folder',
    id: folder.id,
    version: folder.version,
    data: parseData(folder.data),
  };
}

export function lineFromProto(line: Line): EditableLine {
  return {
    kind: 'line',
    id: line.id,
    version: line.version,
    data: parseData(line.data),
    latLngE7: Int32Array.from(line.latLngE7),
    elevationCentimeters:
        line.elevationCentimeters.length > 0
            ? Int32Array.from(line.elevationCentimeters)
            : undefined,
    timeSeconds: line.timeSeconds.length > 0 ? BigInt64Array.from(line.timeSeconds) : undefined,
  };
}

export function pointFromProto(point: Point): EditablePoint {
  return {
    kind: 'point',
    id: point.id,
    version: point.version,
    data: parseData(point.data),
    latE7: point.latE7,
    lngE7: point.lngE7,
    elevationCentimeters: point.elevationCentimeters,
  };
}

export function toWrite(
    op: SaveOp, feature: EditableFeature): MessageInitShape<typeof WriteSchema> {
  if (op === 'delete') {
    return {
      write: {
        case: 'delete',
        value: {
          kind: FEATURE_KINDS[feature.kind],
          id: feature.id,
          baseVersion: feature.version,
        },
      },
    };
  }

  const data = JSON.stringify(feature.data);
  if (feature.kind === 'folder') {
    return {
      write: {
        case: 'putFolder',
        value: {id: feature.id, data, version: feature.version},
      },
    };
  } else if (feature.kind === 'line') {
    return {
      write: {
        case: 'putLine',
        value: {
          id: feature.id,
          data,
          latLngE7: Array.from(feature.latLngE7),
          elevationCentimeters:
              feature.elevationCentimeters ? Array.from(feature.elevationCentimeters) : [],
          timeSeconds: feature.timeSeconds ? Array.from(feature.timeSeconds) : [],
          version: feature.version,
        },
      },
    };
  } else {
    return {
      write: {
        case: 'putPoint',
        value: {
          id: feature.id,
          data,
          latE7: feature.latE7,
          lngE7: feature.lngE7,
          elevationCentimeters: feature.elevationCentimeters,
          version: feature.version,
        },
      },
    };
  }
}

const FEATURE_KINDS = {
  folder: FeatureKind.FOLDER,
  line: FeatureKind.LINE,
  point: FeatureKind.POINT,
} as const;

function parseData(data: string): FeatureData {
  return data ? JSON.parse(data) : {};
}
