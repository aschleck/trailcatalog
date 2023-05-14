import earcut from 'earcut';

import * as arrays from 'js/common/arrays';
import { checkArgument, checkExists } from 'js/common/asserts';
import { LittleEndianView } from 'js/common/little_endian_view';

import { Area, AreaType, Boundary, Contour, Highway, HighwayType, Label, LabelType, MbtileTile, Polygon, TileId, Waterway } from '../common/types';

// TODO(april): shouldn't need to put these here, but we only have one style anyway
const CONTOUR_LABEL_EVERY = 0.000007;
const MAX_POLYGONS_IN_AREA = 500;
const TEXT_DECODER = new TextDecoder();
const LABEL_WRAP_WIDTH = 16;

const MAX_GEOMETRY_SIZE = 8_000_000;
const MAX_INDICES_SIZE = 512_000;

const PREFERRED_LANGUAGE = navigator.language.split('-')[0];

interface Feature {
  type: number;
  tags: number[];
  geometry: number[];
  starts: number[];
}

interface VertexBuffers {
  geometry: Float64Array;
  geometryOffset: number;
  indices: Uint32Array;
  indexOffset: number;
}

enum GeometryType {
  Point = 1,
  Line = 2,
  Polygon = 3,
}

export function decodeMbtile(id: TileId, buffer: ArrayBuffer): MbtileTile {
  // Who amonst us hasn't written a proto parser manually...
  // https://github.com/mapbox/vector-tile-spec/blob/master/2.1/vector_tile.proto
  const data = new LittleEndianView(buffer);
  const tile: MbtileTile & VertexBuffers = {
    areas: [],
    boundaries: [],
    contoursFt: [],
    contoursM: [],
    highways: [],
    labels: [],
    waterways: [],

    geometry: new Float64Array(MAX_GEOMETRY_SIZE / Float64Array.BYTES_PER_ELEMENT),
    geometryOffset: 0,
    indices: new Uint32Array(MAX_INDICES_SIZE / Uint32Array.BYTES_PER_ELEMENT),
    indexOffset: 0,
  };
  while (data.hasRemaining()) {
    const tag = data.getInt8();
    const wireType = tag & 0x7;
    const field = tag >> 3;

    if (wireType === 2) {
      const size = data.getVarInt32();
      const embedded = data.viewSlice(size);
      if (field === 3) {
        loadLayer(id, embedded, tile);
      }
    } else {
      throw new Error(`Unknown wire type ${wireType} for field ${field}`);
    }
  }

  tile.labels = wrapLabels(tile.labels);

  return tile;
}

function loadLayer(id: TileId, data: LittleEndianView, tile: MbtileTile & VertexBuffers): void {
  let version;
  let name = '';
  let extent = 4096;
  const keys = [];
  const values = [];
  const features = [];
  while (data.hasRemaining()) {
    const tag = data.getInt8();
    const wireType = tag & 0x7;
    const field = tag >> 3;

    if (wireType === 0) {
      const value = data.getVarInt32();
      if (field === 5) {
        extent = value;
      } else if (field === 15) {
        version = value;
      }
    } else if (wireType === 2) {
      const size = data.getVarInt32();
      if (field === 1) {
        name = TEXT_DECODER.decode(data.sliceInt8(size));
      } else if (field === 2) {
        features.push(loadFeature(data.viewSlice(size)));
      } else if (field === 3) {
        keys.push(TEXT_DECODER.decode(data.sliceInt8(size)));
      } else if (field === 4) {
        values.push(loadValue(data.viewSlice(size)));
      } else {
        const embedded = data.viewSlice(size);
      }
    } else {
      throw new Error(`Unknown wire type ${wireType} for field ${field}`);
    }
  }

  if (name === 'boundary') {
    arrays.pushInto(tile.boundaries, projectBoundaries(id, keys, values, features, extent, tile));
  } else if (name === 'contour') {
    tile.contoursM = projectContours(id, keys, values, features, extent, tile);
  } else if (name === 'contour_ft') {
    tile.contoursFt = projectContours(id, keys, values, features, extent, tile);
  } else if (name === 'globallandcover') {
    const areas = [];
    for (const feature of features) {
      const tags = feature.tags;
      let type = undefined;
      let priority = -1;
      for (let i = 0; i < tags.length; i += 2) {
        const key = keys[tags[i]];
        const value = values[tags[i + 1]];
        if (key === 'class') {
          if (value === 'crop') {
            type = AreaType.GlobalLandcoverCrop;
            priority = 0;
          } else if (value === 'forest' || value === 'tree') {
            type = AreaType.GlobalLandcoverForest;
            priority = 2;
          } else if (value === 'grass') {
            type = AreaType.GlobalLandcoverGrass;
            priority = 0;
          } else if (value === 'scrub') {
            type = AreaType.GlobalLandcoverScrub;
            priority = 0;
          }
        }
      }

      if (!type) {
        continue;
      }

      areas.push({
        type,
        polygons: projectPolygonalFeature(id, feature, extent, tile),
        priority,
      });
    }

    arrays.pushInto(tile.areas, compressAreas(areas, tile));
  } else if (name === 'landcover') {
    const areas = [];
    for (const feature of features) {
      const tags = feature.tags;
      let type = undefined;
      let priority = -1;
      for (let i = 0; i < tags.length; i += 2) {
        const key = keys[tags[i]];
        const value = values[tags[i + 1]];
        if (key === 'class') {
          if (value === 'grass') {
            type = AreaType.LandcoverGrass;
            priority = 3;
          } else if (value === 'ice') {
            type = AreaType.LandcoverIce;
            priority = 1;
          } else if (value === 'sand') {
            type = AreaType.LandcoverSand;
            priority = 3;
          } else if (value === 'wood') {
            type = AreaType.LandcoverWood;
            priority = 3;
          }
        }
      }

      if (type) {
        areas.push({
          type,
          polygons: projectPolygonalFeature(id, feature, extent, tile),
          priority,
        });
      }
    }

    arrays.pushInto(tile.areas, compressAreas(areas, tile));
  } else if (name === 'landuse') {
    const areas = [];
    for (const feature of features) {
      const tags = feature.tags;
      let type = undefined;
      let priority = -1;
      for (let i = 0; i < tags.length; i += 2) {
        const key = keys[tags[i]];
        const value = values[tags[i + 1]];
        if (key === 'class') {
          if (value === 'neighbourhood' || value === 'residential' || value === 'suburb') {
            type = AreaType.LanduseHuman;
            priority = 3;
          }
        }
      }

      if (type) {
        areas.push({
          type,
          polygons: projectPolygonalFeature(id, feature, extent, tile),
          priority,
        });
      }
    }

    arrays.pushInto(tile.areas, compressAreas(areas, tile));
  } else if (name === 'mountain_peak') {
    const {labels} = projectLabels(id, keys, values, features, extent, tile);
    arrays.pushInto(tile.labels, labels);
  } else if (name === 'park') {
    const {areas, labels} = projectParks(id, keys, values, features, extent, tile);
    arrays.pushInto(tile.areas, areas);
    arrays.pushInto(tile.labels, labels);
  } else if (name === 'place') {
    const {labels} = projectLabels(id, keys, values, features, extent, tile);
    arrays.pushInto(tile.labels, labels);
  } else if (name === 'transportation') {
    const {areas, highways} = projectTransportation(id, keys, values, features, extent, tile);
    arrays.pushInto(tile.areas, areas);
    arrays.pushInto(tile.highways, highways);
  } else if (name === 'water') {
    const areas = [];
    for (const feature of features) {
      areas.push({
        type: AreaType.Water,
        polygons: projectPolygonalFeature(id, feature, extent, tile),
        priority: 4,
      });
    }
    arrays.pushInto(tile.areas, compressAreas(areas, tile));
  } else if (name === 'waterway') {
    const {areas, waterways} = projectWaterways(id, keys, values, features, extent, tile);
    arrays.pushInto(tile.areas, areas);
    arrays.pushInto(tile.waterways, waterways);
  }
}

function loadFeature(data: LittleEndianView): Feature {
  let type;
  let tags;
  let geometry;
  let starts;
  while (data.hasRemaining()) {
    const tag = data.getInt8();
    const wireType = tag & 0x7;
    const field = tag >> 3;

    if (wireType === 0) {
      const value = data.getVarInt32();
      if (field === 3) {
        type = value;
      }
    } else if (wireType === 2) {
      const slice = data.viewSlice(data.getVarInt32());
      if (field === 2) {
        tags = loadPackedInt32s(slice);
      } else if (field === 4) {
        const result = decodeGeometry(loadPackedInt32s(slice));
        geometry = result.geometry;
        starts = result.starts;
      }
    } else {
      throw new Error(`Unknown wire type ${wireType} for field ${field}`);
    }
  }

  return {
    type: checkExists(type),
    tags: tags ?? [],
    geometry: checkExists(geometry),
    starts: checkExists(starts),
  };
}

function loadValue(data: LittleEndianView): boolean|number|string {
  let boolean;
  let number;
  let string;
  while (data.hasRemaining()) {
    const tag = data.getInt8();
    const wireType = tag & 0x7;
    const field = tag >> 3;

    if (wireType === 0) {
      const value = data.getVarInt32();
      if (field === 4 || field === 5) {
        number = value;
      } else if (field === 6) {
        number = deZigZag(value);
      } else if (field === 7) {
        boolean = !!value;
      }
    } else if (wireType === 2) {
      const size = data.getVarInt32();
      if (field === 1) {
        string = TEXT_DECODER.decode(data.sliceInt8(size));
      } else {
        throw new Error(`Unknown field ${field}`);
      }
    } else {
      throw new Error(`Unknown wire type ${wireType} for field ${field}`);
    }
  }

  return boolean ?? number ?? string ?? 0;
}

function decodeGeometry(data: number[]): {
  geometry: number[];
  starts: number[];
} {
  const cursor = [0, 0];
  const geometry: number[] = [];
  const starts: number[] = [];

  for (let i = 0; i < data.length; ) {
    const tag = data[i];
    i += 1;
    const command = tag & 0x7;
    const count = tag >> 3;
    if (command === 1) { // move to
      for (let j = 0; j < count; j += 1, i += 2) {
        starts.push(geometry.length);
        const x = cursor[0] + deZigZag(data[i + 0]);
        const y = cursor[1] + deZigZag(data[i + 1]);
        geometry.push(x, y);
        cursor[0] = x;
        cursor[1] = y;
      }
    } else if (command === 2) { // line to
      for (let j = 0; j < count; j += 1, i += 2) {
        const x = cursor[0] + deZigZag(data[i + 0]);
        const y = cursor[1] + deZigZag(data[i + 1]);
        geometry.push(x, y);
        cursor[0] = x;
        cursor[1] = y;
      }
    } else if (command === 7) { // close path
      checkArgument(count === 1);
      // we actually don't need to do anything because the last point is the first point
    } else {
      throw new Error(`Unknown command ${command}`);
    }
  }
  return {
    geometry,
    starts,
  };
}

function loadPackedInt32s(data: LittleEndianView): number[] {
  const values = [];
  while (data.hasRemaining()) {
    values.push(data.getVarInt32());
  }
  return values;
}

function deZigZag(u: number): number {
  return (u >>> 1) ^ -(u & 1);
}

function projectPolygonalFeature(
    id: TileId,
    feature: Feature,
    extent: number,
    buffers: VertexBuffers): Polygon[] {
  const {polygonsss} = projectGeometries(id, [feature], extent);
  if (polygonsss.length === 0) {
    return [];
  }

  const out: Polygon[] = [];
  for (const polygons of polygonsss[0]) {
    projectPolygons(polygons, out, buffers);
  }

  return out;
}

function projectPolygons(polygons: Float64Array[], out: Polygon[], buffers: VertexBuffers): void {
  polygons.length = Math.min(polygons.length, MAX_POLYGONS_IN_AREA);

  const exteriorSize = polygons[0].length;
  let holeSize = 0;
  for (let j = 1; j < polygons.length; ++j) {
    holeSize += polygons[j].length;
  }

  const vertices = new Float64Array(exteriorSize + holeSize);
  const holes = [];
  let offset = 0;
  for (const polygon of polygons) {
    if (offset > 0) {
      holes.push(offset / 2);
    }

    vertices.set(polygon, offset);
    offset += polygon.length;
  }

  const indices = earcut(vertices, holes);
  out.push({
    indexLength: indices.length,
    indexOffset: buffers.indexOffset,
    vertexLength: vertices.length,
    vertexOffset: buffers.geometryOffset,
  });

  buffers.geometry.set(vertices, buffers.geometryOffset);
  buffers.geometryOffset += vertices.length;
  buffers.indices.set(indices, buffers.indexOffset);
  buffers.indexOffset += indices.length;
}

function projectBoundaries(
    id: TileId,
    keys: string[],
    values: Array<boolean|number|string>,
    features: Feature[],
    extent: number,
    buffers: VertexBuffers): Boundary[] {
  const {liness} = projectGeometries(id, features, extent);
  const lines = [];
  for (let i = 0; i < features.length; ++i) {
    const projected = liness[i];
    const tags = features[i].tags;

    let adminLevel = -1;
    for (let i = 0; i < tags.length; i += 2) {
      if (keys[tags[i]] === 'admin_level') {
        adminLevel = values[tags[i + 1]] as number;
      }
    }

    if (adminLevel < 0) {
      continue;
    }

    for (const vertices of liness[i]) {
      lines.push({
        adminLevel,
        vertexLength: vertices.length,
        vertexOffset: buffers.geometryOffset,
      });
      buffers.geometry.set(vertices, buffers.geometryOffset);
      buffers.geometryOffset += vertices.length;
    }
  }
  return lines;
}

function projectContours(
    id: TileId,
    keys: string[],
    values: Array<boolean|number|string>,
    features: Feature[],
    extent: number,
    buffers: VertexBuffers): Contour[] {
  const {liness} = projectGeometries(id, features, extent);
  const lines = [];
  for (let i = 0; i < features.length; ++i) {
    const projected = liness[i];
    const tags = features[i].tags;

    let height = 0;
    let nthLine = 1;
    for (let i = 0; i < tags.length; i += 2) {
      if (keys[tags[i]] === 'height') {
        height = values[tags[i + 1]] as number;
      } else if (keys[tags[i]] === 'nth_line') {
        nthLine = values[tags[i + 1]] as number;
      }
    }

    for (const vertices of liness[i]) {
      const vertexOffset = buffers.geometryOffset;
      buffers.geometry.set(vertices, vertexOffset);
      buffers.geometryOffset += vertices.length;

      let distance = -CONTOUR_LABEL_EVERY;
      const labelOffset = buffers.geometryOffset;
      let labelLength = 0;
      for (let j = 0; j < vertices.length - 2; j += 2) {
        const dx = vertices[j + 0 + 2] - vertices[j + 0];
        const dy = vertices[j + 1 + 2] - vertices[j + 1];
        distance += Math.sqrt(dx * dx + dy * dy);

        if (distance >= CONTOUR_LABEL_EVERY) {
          const direction = Math.atan2(dx, dy);
          const angle = direction > 0 ? Math.PI / 2 - direction : 3 / 2 * Math.PI - direction;
          buffers.geometry.set([angle, vertices[j], vertices[j + 1]], labelOffset + labelLength);
          labelLength += 3;
          distance = 0;
        }
      }

      lines.push({
        height,
        labelLength,
        labelOffset,
        nthLine,
        vertexLength: vertices.length,
        vertexOffset,
      });
    }
  }
  return lines;
}

function projectLabels(
    id: TileId,
    keys: string[],
    values: Array<boolean|number|string>,
    features: Feature[],
    extent: number,
    buffers: VertexBuffers): {
  labels: Label[];
} {
  const {pointss} = projectGeometries(id, features, extent);

  const labels: Label[] = [];
  for (let i = 0; i < pointss.length; ++i) {
    const tags = features[i].tags;

    let type = undefined;
    let textPreferred = undefined;
    let textFallback = undefined;
    let rank = -1;
    for (let i = 0; i < tags.length; i += 2) {
      const key = keys[tags[i]];
      if (key === 'class') {
        const value = values[tags[i + 1]];
        if (value === 'city') {
          type = LabelType.City;
        } else if (value === 'continent') {
          type = LabelType.Continent;
        } else if (value === 'country') {
          type = LabelType.Country;
        } else if (value === 'island') {
          type = LabelType.Island;
        } else if (value === 'peak') {
          type = LabelType.Peak;
        } else if (value === 'province') {
          type = LabelType.Province;
        } else if (value === 'region') {
          type = LabelType.Region;
        } else if (value === 'state') {
          type = LabelType.State;
        } else if (value === 'town') {
          type = LabelType.Town;
        } else if (value === 'village') {
          type = LabelType.Village;
        }
      } else if (key === `name:${PREFERRED_LANGUAGE}`) {
        textPreferred = String(values[tags[i + 1]]);
      } else if (key === 'name') {
        textFallback = String(values[tags[i + 1]]);
      } else if (key === 'rank') {
        rank = Number(values[tags[i + 1]]);
      }
    }

    const constType = type;
    const constText = textPreferred ?? textFallback;
    if (constType !== undefined && constText !== undefined && constText !== '') {
      for (const vertices of pointss[i]) {
        labels.push({
          type: constType,
          positionOffset: buffers.geometryOffset,
          rank,
          text: constText,
        });
        buffers.geometry.set([vertices[0], vertices[1]], buffers.geometryOffset);
        buffers.geometryOffset += 2;
      }
    }
  }
  return {labels};
}

function projectParks(
    id: TileId,
    keys: string[],
    values: Array<boolean|number|string>,
    features: Feature[],
    extent: number,
    buffers: VertexBuffers): {
  areas: Area[];
  labels: Label[];
} {
  const {pointss, polygonsss} = projectGeometries(id, features, extent);

  const areas: Area[] = [];
  for (let i = 0; i < polygonsss.length; ++i) {
    const out: Polygon[] = [];
    for (const polygons of polygonsss[i]) {
      projectPolygons(polygons, out, buffers);
    }

    if (out.length > 0) {
      areas.push({
        type: AreaType.Park,
        polygons: out,
        priority: -1,
      });
    }
  }

  const labels = [];
  for (let i = 0; i < pointss.length; ++i) {
    const tags = features[i].tags;

    let type = undefined;
    let textPreferred = undefined;
    let textFallback = undefined;
    for (let i = 0; i < tags.length; i += 2) {
      const key = keys[tags[i]];
      if (key === 'class') {
        const value = values[tags[i + 1]];
        if (value === 'national_forest') {
          type = LabelType.NationalForest;
        } else if (value === 'national_park') {
          type = LabelType.NationalPark;
        }
      } else if (key === `name:${PREFERRED_LANGUAGE}`) {
        textPreferred = String(values[tags[i + 1]]);
      } else if (key === 'name') {
        textFallback = String(values[tags[i + 1]]);
      }
    }

    const constType = type;
    const constText = textPreferred ?? textFallback;
    if (constType && constText) {
      for (const vertices of pointss[i]) {
        labels.push({
          type: constType,
          positionOffset: buffers.geometryOffset,
          rank: -1,
          text: constText,
        });
        buffers.geometry.set([vertices[0], vertices[1]], buffers.geometryOffset);
        buffers.geometryOffset += 2;
      }
    }
  }

  return {
    areas: compressAreas(areas, buffers),
    labels,
  };
}

function projectTransportation(
    id: TileId,
    keys: string[],
    values: Array<boolean|number|string>,
    features: Feature[],
    extent: number,
    buffers: VertexBuffers): {
  areas: Area[];
  highways: Highway[];
} {
  const {liness, polygonsss} = projectGeometries(id, features, extent);

  const areas: Area[] = [];
  for (let i = 0; i < polygonsss.length; ++i) {
    const out: Polygon[] = [];
    for (const polygons of polygonsss[i]) {
      projectPolygons(polygons, out, buffers);
    }

    if (out.length > 0) {
      areas.push({
        type: AreaType.Transportation,
        polygons: out,
        priority: 5,
      });
    }
  }

  const highways: Highway[] = [];
  for (let i = 0; i < features.length; ++i) {
    const tags = features[i].tags;

    let type = undefined;
    for (let i = 0; i < tags.length; i += 2) {
      const key = keys[tags[i]];
      if (key === 'class') {
        const value = values[tags[i + 1]];
        if (value === 'motorway') {
          type = HighwayType.Major;
        } else if (
            value === 'primary'
                || value === 'trunk'
                || value === 'secondary'
                || value === 'tertiary') {
          type = HighwayType.Arterial;
        } else if (
            value === 'minor'
                || value === 'service'
                || value === 'pier'
                || value === 'raceway') {
          type = HighwayType.Minor;
        }
      }
    }

    const constType = type;
    if (constType !== undefined) {
      for (const vertices of liness[i]) {
        highways.push({
          type: constType,
          vertexOffset: buffers.geometryOffset,
          vertexLength: vertices.length,
        });

        buffers.geometry.set(vertices, buffers.geometryOffset);
        buffers.geometryOffset += vertices.length;
      }
    }
  }
  return {areas, highways};
}

function projectWaterways(
    id: TileId,
    keys: string[],
    values: Array<boolean|number|string>,
    features: Feature[],
    extent: number,
    buffers: VertexBuffers): {
  areas: Area[];
  waterways: Waterway[];
} {
  const {liness, polygonsss} = projectGeometries(id, features, extent);

  const areas: Area[] = [];
  for (let i = 0; i < polygonsss.length; ++i) {
    const out: Polygon[] = [];
    for (const polygons of polygonsss[i]) {
      projectPolygons(polygons, out, buffers);
    }

    if (out.length > 0) {
      areas.push({
        type: AreaType.Water,
        polygons: out,
        priority: 5,
      });
    }
  }

  const waterways: Waterway[] = [];
  for (let i = 0; i < features.length; ++i) {
    const projected = liness[i];
    const tags = features[i].tags;

    for (const vertices of liness[i]) {
      waterways.push({
        type: 'river',
        vertexOffset: buffers.geometryOffset,
        vertexLength: vertices.length,
      });

      buffers.geometry.set(vertices, buffers.geometryOffset);
      buffers.geometryOffset += vertices.length;
    }
  }
  return {areas, waterways};
}

function projectGeometries(id: TileId, features: Feature[], extent: number): {
  liness: Array<Float64Array[]>;
  pointss: Array<Float64Array[]>;
  // exterior ring followed by its interiors, combining into one feature, combining into all
  // features
  polygonsss: Array<Array<Float64Array[]>>;
} {
  const halfWorldSize = Math.pow(2, id.zoom - 1);
  const tx = id.x / halfWorldSize;
  const ty = (id.y - 1) / halfWorldSize;
  const increment = 1 / halfWorldSize / extent;
  const liness = [];
  const pointss = [];
  const polygonsss = [];
  for (const {type, geometry, starts} of features) {
    starts.push(geometry.length);
    let cursor = starts[0];
    const verticess = [];
    for (let i = 1; i < starts.length; ++i) {
      let end = starts[i];
      const vertices = new Float64Array(end - cursor);
      for (let j = cursor; j < end; j += 2) {
        vertices[j - cursor + 0] = tx + geometry[j + 0] * increment;
        vertices[j - cursor + 1] = ty + (extent - geometry[j + 1]) * increment;
      }

      verticess.push(vertices);
      cursor = end;
    }

    if (type === GeometryType.Point) {
      liness.push([]);
      pointss.push(verticess);
      polygonsss.push([]);
    } else if (type === GeometryType.Line) {
      liness.push(verticess);
      pointss.push([]);
      polygonsss.push([]);
    } else if (type === GeometryType.Polygon) {
      const polygonss = [];
      for (const vertices of verticess) {
        let area = 0;
        for (let i = 2; i < vertices.length; i += 2) {
          area += (vertices[i + 0] - vertices[i - 2]) * (vertices[i - 1] + vertices[i + 1]);
        }
        area +=
            (vertices[0] - vertices[vertices.length - 2])
                * (vertices[vertices.length - 1] + vertices[1]);
        if (area > 0) {
          polygonss.push([vertices]);
        } else {
          polygonss[polygonss.length - 1].push(vertices);
        }
      }
      polygonsss.push(polygonss);
      liness.push([]);
      pointss.push([]);
    }
  }

  return {
    liness,
    pointss,
    polygonsss,
  };
}

const scratchGeometry = new Float64Array(MAX_GEOMETRY_SIZE / Float64Array.BYTES_PER_ELEMENT);
const scratchIndices = new Uint32Array(MAX_INDICES_SIZE / Uint32Array.BYTES_PER_ELEMENT);

function compressAreas(areas: Area[], buffers: VertexBuffers): Area[] {
  // ASSUMPTION: areas are all contiguous in the buffer arrays

  let first = undefined;
  for (const area of areas) {
    for (const polygon of area.polygons) {
      first = polygon;
      break;
    }

    if (first !== undefined) {
      break;
    }
  }

  if (!first) {
    return areas;
  }

  const originalGOffset = first.vertexOffset;
  const originalIOffset = first.indexOffset;

  areas.sort((a, b) => a.priority - b.priority);

  let last = areas[0];
  const copied = [last];
  for (let i = 1; i < areas.length; ++i) {
    const area = areas[i];

    if (area.polygons.length < 1) {
      continue;
    }

    if (last.type === area.type) {
      arrays.pushInto(last.polygons, area.polygons);
    } else {
      copied.push(area);
      last = area;
    }
  }

  let scratchGOffset = 0;
  let scratchIOffset = 0;
  for (const area of copied) {
    let startI = scratchIOffset;
    let startG = scratchGOffset;

    for (const polygon of area.polygons) {
      for (let i = 0; i < polygon.indexLength; ++i) {
        scratchIndices[scratchIOffset + i] =
            buffers.indices[polygon.indexOffset + i]
                + (scratchGOffset - startG) / 2;
      }
      scratchIOffset += polygon.indexLength;

      scratchGeometry.set(
          buffers.geometry.subarray(
                polygon.vertexOffset, polygon.vertexOffset + polygon.vertexLength),
          scratchGOffset);
      scratchGOffset += polygon.vertexLength;
    }

    area.polygons.length = 0;
    area.polygons.push({
      indexLength: scratchIOffset - startI,
      indexOffset: originalIOffset + startI,
      vertexLength: scratchGOffset - startG,
      vertexOffset: originalGOffset + startG,
    });
  }

  buffers.geometry.set(scratchGeometry.subarray(0, scratchGOffset), originalGOffset);
  buffers.indices.set(scratchIndices.subarray(0, scratchIOffset), originalIOffset);

  return copied;
}

function wrapLabels(labels: Label[]): Label[] {
  const wrapped = [];
  for (const label of labels) {
    const split = label.text.split(' ');
    let cumulative = '';
    let length = 0;
    for (const s of split) {
      if (length === 0) {
        cumulative += s;
        length += s.length;
      } else if (length + 1 + s.length < LABEL_WRAP_WIDTH) {
        cumulative += ` ${s}`;
        length += 1 + s.length;
      } else {
        cumulative += `\n${s}`;
        length = s.length;
      }
    }

    wrapped.push({
      ...label,
      text: cumulative,
    });
  }
  return wrapped;
}
