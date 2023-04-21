import earcut from 'earcut';

import { checkArgument, checkExists } from 'js/common/asserts';
import { LittleEndianView } from 'js/common/little_endian_view';

import { Area, AreaType, Boundary, Contour, Highway, HighwayType, Label, MbtileTile, Polygon, TileId, Waterway } from '../common/types';

// TODO(april): shouldn't need to put these here, but we only have one style anyway
const CONTOUR_LABEL_EVERY = 0.000007;
const MAX_POLYGONS_IN_AREA = 500;
const TEXT_DECODER = new TextDecoder();

interface Feature {
  type: number;
  tags: number[];
  geometry: number[];
  starts: number[];
}

enum GeometryType {
  Line = 2,
  Polygon = 3,
}

export function decodeMbtile(id: TileId, buffer: ArrayBuffer): MbtileTile {
  // Who amonst us hasn't written a proto parser manually...
  // https://github.com/mapbox/vector-tile-spec/blob/master/2.1/vector_tile.proto
  const data = new LittleEndianView(buffer);
  const tile: MbtileTile = {
    areas: [],
    boundaries: [],
    contoursFt: [],
    contoursM: [],
    highways: [],
    waterways: [],
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

  compressTile(tile);
  return tile;
}

function loadLayer(id: TileId, data: LittleEndianView, tile: MbtileTile): void {
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
    tile.boundaries.push(...projectBoundaries(id, keys, values, features, extent));
  } else if (name === 'contour') {
    tile.contoursM = projectContours(id, keys, values, features, extent);
  } else if (name === 'contour_ft') {
    tile.contoursFt = projectContours(id, keys, values, features, extent);
  } else if (name === 'globallandcover') {
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

      tile.areas.push({
        type,
        polygons: projectPolygonalFeature(id, feature, extent),
        priority,
      });
    }
  } else if (name === 'landcover') {
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
        tile.areas.push({
          type,
          polygons: projectPolygonalFeature(id, feature, extent),
          priority,
        });
      }
    }
  } else if (name === 'landuse') {
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
        tile.areas.push({
          type,
          polygons: projectPolygonalFeature(id, feature, extent),
          priority,
        });
      }
    }
  } else if (name === 'park') {
    for (const feature of features) {
      tile.areas.push({
        type: AreaType.Park,
        polygons: projectPolygonalFeature(id, feature, extent),
        priority: -1,
      });
    }
  } else if (name === 'transportation') {
    const {areas, highways} = projectTransportation(id, keys, values, features, extent);
    tile.areas.push(...areas);
    tile.highways.push(...highways);
  } else if (name === 'water') {
    for (const feature of features) {
      tile.areas.push({
        type: AreaType.Water,
        polygons: projectPolygonalFeature(id, feature, extent),
        priority: 4,
      });
    }
  } else if (name === 'waterway') {
    const {areas, waterways} = projectWaterways(id, keys, values, features, extent);
    tile.areas.push(...areas);
    tile.waterways.push(...waterways);
  } else {
    console.log(name);
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
    extent: number): Polygon[] {
  const {polygonsss} = projectGeometries(id, [feature], extent);
  if (polygonsss.length === 0) {
    return [];
  }

  const out: Polygon[] = [];
  for (const polygons of polygonsss[0]) {
    projectPolygons(polygons, out);
  }
  return out;
}

function projectPolygons(polygons: Float64Array[], out: Polygon[]): void {
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
    indices,
    vertices,
  });
}

function projectBoundaries(
    id: TileId,
    keys: string[],
    values: Array<boolean|number|string>,
    features: Feature[],
    extent: number): Boundary[] {
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
        vertices,
      });
    }
  }
  return lines;
}

function projectContours(
    id: TileId,
    keys: string[],
    values: Array<boolean|number|string>,
    features: Feature[],
    extent: number): Contour[] {
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
      const labels: Label[] = [];
      let distance = -CONTOUR_LABEL_EVERY;
      for (let j = 0; j < vertices.length - 2; j += 2) {
        const dx = vertices[j + 0 + 2] - vertices[j + 0];
        const dy = vertices[j + 1 + 2] - vertices[j + 1];
        distance += Math.sqrt(dx * dx + dy * dy);

        if (distance >= CONTOUR_LABEL_EVERY) {
          const direction = Math.atan2(dx, dy);
          const angle = direction > 0 ? Math.PI / 2 - direction : 3 / 2 * Math.PI - direction;
          labels.push({
            angle,
            position: [vertices[j], vertices[j + 1]],
          });
          distance = 0;
        }
      }
      lines.push({
        height,
        labels,
        nthLine,
        vertices,
      });
    }
  }
  return lines;
}

function projectTransportation(
    id: TileId,
    keys: string[],
    values: Array<boolean|number|string>,
    features: Feature[],
    extent: number): {
  areas: Area[];
  highways: Highway[];
} {
  const {liness, polygonsss} = projectGeometries(id, features, extent);

  const areas: Area[] = [];
  for (let i = 0; i < polygonsss.length; ++i) {
    const out: Polygon[] = [];
    for (const polygons of polygonsss[i]) {
      projectPolygons(polygons, out);
    }

    areas.push({
      type: AreaType.Transportation,
      polygons: out,
      priority: 5,
    });
  }

  const highways: Highway[] = [];
  for (let i = 0; i < features.length; ++i) {
    const projected = liness[i];
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
          vertices,
        });
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
    extent: number): {
  areas: Area[];
  waterways: Waterway[];
} {
  const {liness, polygonsss} = projectGeometries(id, features, extent);

  const areas: Area[] = [];
  for (let i = 0; i < polygonsss.length; ++i) {
    const out: Polygon[] = [];
    for (const polygons of polygonsss[i]) {
      projectPolygons(polygons, out);
    }

    areas.push({
      type: AreaType.Water,
      polygons: out,
      priority: 5,
    });
  }

  const waterways: Waterway[] = [];
  for (let i = 0; i < features.length; ++i) {
    const projected = liness[i];
    const tags = features[i].tags;

    for (const vertices of liness[i]) {
      waterways.push({
        type: 'river',
        vertices,
      });
    }
  }
  return {areas, waterways};
}

function projectGeometries(id: TileId, features: Feature[], extent: number): {
  liness: Array<Float64Array[]>;
  // exterior ring followed by its interiors, combining into one feature, combining into all
  // features
  polygonsss: Array<Array<Float64Array[]>>;
} {
  const halfWorldSize = Math.pow(2, id.zoom - 1);
  const tx = id.x / halfWorldSize;
  const ty = (id.y - 1) / halfWorldSize;
  const increment = 1 / halfWorldSize / extent;
  const liness = [];
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

    if (type === GeometryType.Line) {
      liness.push(verticess);
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
    }
  }

  return {
    liness,
    polygonsss,
  };
}

function compressTile(tile: MbtileTile): void {
  tile.areas.sort((a, b) => a.priority - b.priority);

  if (tile.areas.length > 1) {
    let last = tile.areas[0];
    const copied = [last];
    for (let i = 1; i < tile.areas.length; ++i) {
      const area = tile.areas[i];

      if (area.polygons.length === 0) {
        continue;
      }

      if (last.type === area.type) {
        last.polygons.push(...area.polygons);
      } else {
        copied.push(area);
        last = area;
      }
    }

    for (const area of copied) {
      if (area.polygons.length <= 1) {
        continue;
      }

      let size = 0;
      for (const polygon of area.polygons) {
        size += polygon.vertices.length;
      }

      const indices = [];
      const vertices = new Float64Array(size);
      let offset = 0;
      for (const polygon of area.polygons) {
        for (const index of polygon.indices) {
          indices.push(index + offset / 2);
        }

        vertices.set(polygon.vertices, offset);
        offset += polygon.vertices.length;
      }

      area.polygons.length = 0;
      area.polygons.push({
        indices,
        vertices,
      });
    }

    tile.areas = copied;
  }
}
