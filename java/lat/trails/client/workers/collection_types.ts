import { LatLngRect, RawUuid, Rect, RgbaU32, Vec2 } from 'js/map/common/types';
import { LinePattern } from 'js/map/rendering/line_program';
import { PackedLines } from 'js/map/workers/routing/location_querier';
import { CellKey } from 'js/map/workers/s2/s2_streams';
import { Triangles } from 'js/map/workers/tiles/triangulate';

import { CollectionSchema } from './collection_schema';
import { Match } from './filters';

export interface Initialize {
  styling: Styling;
}

interface SetStyleRequest {
  kind: 'sr';
  styling: Styling;
}

// Rules written by hand, like the OSM ways', or a collection's own schema
export type Styling = {kind: 'rules'; style: Style}|{kind: 'schema'; schema: CollectionSchema};

/** Picks how an object draws, or undefined to drop it. */
export interface Styler {
  line(data: Data, styleZoom: number): LineStyle|undefined;
  point(data: Data): PointStyle|undefined;
  polygon(data: Data): PolygonStyle|undefined;
}

export interface Style {
  lines: LineStyle[];
  points: PointStyle[];
  polygons: PolygonStyle[];
}

export interface LineStyle {
  filters: Match[];
  // Half open, matching the bands in the mbtile styles.
  minZoom: number;
  maxZoom: number;
  fill: RgbaU32;
  // A wider solid line drawn under this one, at a z of its own so that it can also pass under the
  // lines this one crosses
  halo?: {fill: RgbaU32; radius: number; z: number};
  pattern: LinePattern;
  radius: number;
  stroke: RgbaU32;
  z: number;
}

export interface PointStyle {
  filters: Match[];
  fill: RgbaU32;
  stroke: RgbaU32;
  radius: number;
  z: number;
}

export interface PolygonStyle {
  filters: Match[];
  fill: RgbaU32;
  // Drawn along every ring, or not at all when undefined
  outline: LineStyle|undefined;
  z: number;
}

export interface LoadRequest {
  kind: 'lr';
  key: CellKey;
  styleZoom: number;
  // Unused here, only echoed so that the answer says what its geometry was simplified to.
  tolerance: number;
  data: ArrayBuffer;
}

export type Request = LoadRequest|SetStyleRequest;

export interface LoadResponse {
  kind: 'lr';
  key: CellKey;
  tolerance: number;
  geometry: ArrayBuffer;
  index: ArrayBuffer;
  // We merge multiple objects into the *Geometry version, so if we want just the geometry of any
  // one object then we keep the non-*Geometry arrays too.
  lines: LoadedLines;
  lineGeometries: LineGeometry[];
  points: Point[];
  polygons: Polygon[];
  polygonGeometries: PolygonGeometry[];
}

/**
 * A cell's lines in parallel arrays, because a cell runs to a hundred thousand lines and cloning an
 * object graph that size is what stalls the main thread. See collection_layer.ts#lineAt.
 */
export interface LoadedLines extends Omit<PackedLines, 'idPrefix'> {
  // lsb then msb for each line
  ids: BigInt64Array;
  data: PackedData;
  geometryByteLengths: Uint32Array;
  geometryOffsets: Uint32Array;
  // Indices into styles
  styleIndices: Uint16Array;
  styles: LineStyle[];
}

type PackedData =
    {kind: 'packed_path'; ids: Float64Array; types: Int32Array; traits: Int32Array}
        |{kind: 'json'; values: Data[]};

export interface Line {
  id: RawUuid;
  data: Data;
  geometryByteLength: number;
  geometryOffset: number;
  // Mercator, which is what the location querier hit tests in and what the hover highlight repushes
  // through LineProgram.
  points: Float64Array;
  // What drew it, so the highlight can size itself against it and putting it back after a hover
  // does not have to guess.
  style: LineStyle;
}

export interface LineGeometry {
  bounds: {box: Rect; margin: number};
  geometryByteLength: number;
  geometryOffset: number;
  instanceCount: number;
  vertexCount: number;
  z: number;
}

export interface Point {
  id: RawUuid;
  data: Data;
  // where the point is in the cell's geometry buffer, so hovering can hide and restore it
  geometryByteLength: number;
  geometryOffset: number;
  // in mercator
  position: Vec2;
  style: PointStyle;
}

export interface Polygon {
  id: RawUuid;
  // For the location querier, which indexes objects by bound and only decodes what a query hits.
  bound: LatLngRect;
  data: Data;
  geometryByteLength: number;
  // relative the start of the polygon geometry
  geometryOffset: number;
  indexCount: number;
  // relative the start of the polygon indices
  indexOffset: number;
  raw: ArrayBuffer;
  triangles: Triangles;
  // Closed mercator rings of the boundary, so a hover can outline it without the main thread
  // decoding the polygon again. Float32 because that is what projectS2Loop hands back and what the
  // vertex buffer holds, and a state forest runs to thousands of rings.
  outline: Float32Array[];
  style: PolygonStyle;
}

export interface PolygonGeometry {
  geometryByteLength: number;
  geometryOffset: number;
  indexCount: number;
  indexOffset: number;
  z: number;
}

export type Response = LoadResponse;

export type Data = {[key: string]: boolean|number|string};
