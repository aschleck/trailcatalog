import { checkArgument, checkExhaustive, checkExists } from 'js/common/asserts';
import { HashMap } from 'js/common/collections';
import { debugMode } from 'js/common/debug';
import { getUnitSystem, UnitSystem } from 'js/server/ssr_aware';

import { rgbaToUint32 } from '../common/math';
import { Area, AreaType, Boundary, Contour, Highway, HighwayType, Label, LabelType, MbtileTile, MbtileTileset, RgbaU32, TileId, Vec2, Waterway } from '../common/types';
import { Camera } from '../models/camera';
import { Line } from '../rendering/geometry';
import { RenderBaker, RenderBakerFactory } from '../rendering/render_baker';
import { Renderer } from '../rendering/renderer';
import { SdfPlanner } from '../rendering/sdf_planner';

import { Layer } from '../layer';

import { TileDataService } from './tile_data_service';

const BOUNDARY_FILL = rgbaToUint32(0, 0, 0, 0.15);
const BOUNDARY_STROKE = rgbaToUint32(0, 0, 0, 0.15);
const BOUNDARY_RADIUS = 1;
const BOUNDARY_Z = 2;
const CONTOUR_FILL = rgbaToUint32(0, 0, 0, 0.1);
const CONTOUR_STROKE = rgbaToUint32(0, 0, 0, 0.1);
const CONTOUR_NORMAL_RADIUS = 0.75;
const CONTOUR_EMPHASIZED_RADIUS = 1.5;
const CONTOUR_Z = 1;
const CONTOUR_LABEL_FILL = rgbaToUint32(0.1, 0.1, 0.1, 1);
const CONTOUR_LABEL_STROKE = rgbaToUint32(1, 1, 1, 1);
const CONTOUR_LABEL_Z = 1;
const WATERWAY_FILL = rgbaToUint32(104 / 255, 167 / 255, 196 / 255, 1);
const WATERWAY_STROKE = rgbaToUint32(104 / 255, 167 / 255, 196 / 255, 1);

const HIGHWAY_FILL = rgbaToUint32(1, 1, 1, 1);
const HIGHWAY_STROKE = rgbaToUint32(0.5, 0.5, 0.5, 1);
const HIGHWAY_MAJOR_RADIUS = 3;
const HIGHWAY_ARTERIAL_RADIUS = 2;
const HIGHWAY_MINOR_RADIUS = 1.5;
const HIGHWAY_Z = 3;

const AREA_Z = 0;
const GLOBAL_LANDCOVER_CROP_FILL = rgbaToUint32(250 / 255, 240 / 255, 225 / 255, 0.9);
const GLOBAL_LANDCOVER_FOREST_FILL = rgbaToUint32(191 / 255, 202 / 255, 155 / 255, 0.9);
const GLOBAL_LANDCOVER_GRASS_FILL = rgbaToUint32(222 / 255, 227 / 255, 192 / 255, 0.9);
const GLOBAL_LANDCOVER_SCRUB_FILL = rgbaToUint32(203 / 255, 215 / 255, 168 / 255, 0.9);
const LANDCOVER_GRASS_FILL = rgbaToUint32(213 / 255, 224 / 255, 190 / 255, 1);
const LANDCOVER_ICE_FILL = rgbaToUint32(1, 1, 1, 1);
const LANDCOVER_SAND_FILL = rgbaToUint32(252 / 255, 247 / 255, 204 / 255, 1);
const LANDCOVER_WOOD_FILL = rgbaToUint32(191 / 255, 202 / 255, 155 / 255, 1);
const LANDUSE_HUMAN_FILL = rgbaToUint32(230 / 255, 230 / 255, 230 / 255, 1);
const PARK_FILL = rgbaToUint32(227 / 255, 239 / 255, 190 / 255, 1);
const WATER_FILL = rgbaToUint32(104 / 255, 167 / 255, 196 / 255, 1);

const LABEL_Z = 4;
const PRIMARY_LABEL_FILL = rgbaToUint32(0.1, 0.1, 0.1, 1);
const PRIMARY_LABEL_STROKE = rgbaToUint32(1, 1, 1, 1);
const PRIMARY_LABEL_SIZE = 0.9;
const SECONDARY_LABEL_FILL = rgbaToUint32(0.1, 0.1, 0.1, 1);
const SECONDARY_LABEL_STROKE = rgbaToUint32(1, 1, 1, 1);
const SECONDARY_LABEL_SIZE = 0.6;
const TERTIARY_LABEL_FILL = rgbaToUint32(0.5, 0.5, 0.5, 1);
const TERTIARY_LABEL_STROKE = rgbaToUint32(0.95, 0.95, 0.95, 1);
const TERTIARY_LABEL_SIZE = 0.5;

const TILE_INDEX_BYTE_SIZE = 2_097_152;
const TILE_GEOMETRY_BYTE_SIZE = 4_194_304;

interface RenderableMbtileTile extends MbtileTile {
  areas: RenderedArea[];
  boundaries: RenderedLine<Boundary>[];
  contoursFt: RenderedLine<Contour>[];
  contoursM: RenderedLine<Contour>[];
  highwayss: {
    major: RenderedLine<Highway>[];
    arterial: RenderedLine<Highway>[];
    minor: RenderedLine<Highway>[];
  };
  labels: RenderedLabel[];
  waterways: RenderedLine<Waterway>[];
}

type RenderedArea = Area & {
  fill: RgbaU32;
};

type RenderedLabel = Label & {
  fill: RgbaU32;
  stroke: RgbaU32;
};

type RenderedLine<T> = Line & T;

export class MbtileData extends Layer {

  private lastChange: number;
  private lastUnit: UnitSystem;
  private readonly tiles: HashMap<TileId, {
    baked: RenderBaker;
    raw: MbtileTile;
  }>;
  private readonly sdfItalic: SdfPlanner;
  private readonly sdfNormal: SdfPlanner;

  constructor(
      private readonly camera: Camera,
      private readonly dataService: TileDataService,
      private readonly renderer: Renderer,
      private readonly renderBakerFactory: RenderBakerFactory,
      tileset: MbtileTileset,
  ) {
    super();
    this.lastChange = Date.now();
    this.lastUnit = getUnitSystem();
    this.tiles = new HashMap(id => `${id.x},${id.y},${id.zoom}`);
    this.sdfItalic = new SdfPlanner('italic', renderer);
    this.registerDisposable(this.sdfItalic);
    this.sdfNormal = new SdfPlanner('normal', renderer);
    this.registerDisposable(this.sdfNormal);

    this.registerDisposable(this.dataService.streamMbtiles(tileset, this));
  }

  hasDataNewerThan(time: number): boolean {
    return this.lastChange > time;
  }

  plan(viewportSize: Vec2, zoom: number, baker: RenderBaker): void {
    const sorted = [...this.tiles].sort((a, b) => a[0].zoom - b[0].zoom);

    const unit = getUnitSystem();
    if (unit !== this.lastUnit) {
      for (const [id, tile] of sorted) {
        tile.baked.clear();
        this.bakeTile(id, tile.raw, tile.baked);
      }
      this.lastUnit = unit;
    }

    for (const [id, tile] of sorted) {
      baker.addPrebaked(tile.baked);
    }
  }

  viewportBoundsChanged(viewportSize: Vec2, zoom: number): void {
    this.dataService.updateViewport(this.camera.centerPixel, viewportSize, zoom);
  }

  loadTile(id: TileId, tile: MbtileTile): void {
    this.lastChange = Date.now();

    const baker =
        this.renderBakerFactory.createChild(TILE_GEOMETRY_BYTE_SIZE, TILE_INDEX_BYTE_SIZE);
    this.bakeTile(id, tile, baker);
    this.tiles.set(id, {
      baked: baker,
      raw: tile,
    });
  }

  unloadTiles(ids: TileId[]): void {
    for (const id of ids) {
      this.tiles.delete(id);
    }
    this.lastChange = Date.now();
  }

  private bakeTile(id: TileId, tile: MbtileTile, baker: RenderBaker): void {
    this.bakeAreas(tile, baker);
    this.bakeContours(tile, id.zoom, baker);
    this.bakeHighways(tile, id.zoom, baker);
    this.bakeLabels(tile, id.zoom, baker);
  }

  private bakeAreas(tile: MbtileTile, baker: RenderBaker): void {
    for (const area of tile.areas) {
      let color;
      if (area.type === AreaType.GlobalLandcoverCrop) {
        color = GLOBAL_LANDCOVER_CROP_FILL;
      } else if (area.type === AreaType.GlobalLandcoverForest) {
        color = GLOBAL_LANDCOVER_FOREST_FILL;
      } else if (area.type === AreaType.GlobalLandcoverGrass) {
        color = GLOBAL_LANDCOVER_GRASS_FILL;
      } else if (area.type === AreaType.GlobalLandcoverScrub) {
        color = GLOBAL_LANDCOVER_SCRUB_FILL;
      } else if (area.type === AreaType.LandcoverGrass) {
        color = LANDCOVER_GRASS_FILL;
      } else if (area.type === AreaType.LandcoverIce) {
        color = LANDCOVER_ICE_FILL;
      } else if (area.type === AreaType.LandcoverSand) {
        color = LANDCOVER_SAND_FILL;
      } else if (area.type === AreaType.LandcoverWood) {
        color = LANDCOVER_WOOD_FILL;
      } else if (area.type === AreaType.LanduseHuman) {
        color = LANDUSE_HUMAN_FILL;
      } else if (area.type === AreaType.Park) {
        // Disable parks
        //color = PARK_FILL;
      } else if (area.type === AreaType.Transportation) {
        color = HIGHWAY_FILL;
      } else if (area.type === AreaType.Water) {
        color = WATER_FILL;
      }

      const constColor = color;
      if (constColor !== undefined) {
        for (const polygon of area.polygons) {
          baker.addTriangles(
              tile.indices.subarray(
                    polygon.indexOffset,
                    polygon.indexOffset + polygon.indexLength),
              tile.geometry.subarray(
                    polygon.vertexOffset,
                    polygon.vertexOffset + polygon.vertexLength),
              constColor,
              AREA_Z);
        }
      }
    }
  }

  private bakeContours(tile: MbtileTile, zoom: number, baker: RenderBaker): void {
    let contours;
    const unit = getUnitSystem();
    if (unit === 'imperial') {
      contours = tile.contoursFt;
    } else if (unit === 'metric') {
      contours = tile.contoursM;
    } else {
      throw checkExhaustive(unit);
    }

    const bold: Line[] = [];
    const regular = [];
    for (const contour of contours) {
      const line = {
        colorFill: CONTOUR_FILL,
        colorStroke: CONTOUR_STROKE,
        stipple: false,
        vertices: tile.geometry,
        verticesOffset: contour.vertexOffset,
        verticesLength: contour.vertexLength,
      };

      if (zoom > 14) {
        if (contour.nthLine === 10) {
          bold.push(line);
        } else {
          regular.push(line);
        }
      } else if (contour.nthLine >= 5) {
        regular.push(line);
      }

      if (contour.nthLine === 10 && zoom >= 14) {
        for (let i = 0; i < contour.labelLength; i += 3) {
          const by2 = i % 2;
          const by3 = i % 3;
          const by5 = i % 5;
          const by7 = i % 7;
          if (zoom < 15.5) {
            continue;
          } else if (zoom < 17 && by2 > 0) {
            continue;
          } else if (zoom < 18 && by3 > 0) {
            continue;
          } else if (zoom < 19 && by5 > 0) {
            continue;
          }

          this.sdfItalic.plan(
            String(contour.height),
            CONTOUR_LABEL_FILL,
            CONTOUR_LABEL_STROKE,
            0.5,
            [
              tile.geometry[contour.labelOffset + i + 1],
              tile.geometry[contour.labelOffset + i + 2],
            ],
            [0, 0],
            tile.geometry[contour.labelOffset + i],
            CONTOUR_LABEL_Z,
            baker);
        }
      }
    }

    baker.addLines(
        bold, CONTOUR_EMPHASIZED_RADIUS, CONTOUR_Z, /* replace= */ false, /* round= */ false);
    baker.addLines(
        regular, CONTOUR_NORMAL_RADIUS, CONTOUR_Z, /* replace= */ false, /* round= */ false);
  }

  private bakeHighways(tile: MbtileTile, zoom: number, baker: RenderBaker): void {
    const major: RenderedLine<Highway>[] = [];
    const arterial: RenderedLine<Highway>[] = [];
    const minor: RenderedLine<Highway>[] = [];
    for (const line of tile.highways) {
      let list;
      if (line.type === HighwayType.Major) {
        list = major;
      } else if (line.type === HighwayType.Arterial) {
        list = arterial;
      } else if (line.type === HighwayType.Minor) {
        list = minor;
      } else {
        throw checkExhaustive(line.type);
      }

      list.push({
        ...line,
        colorFill: HIGHWAY_FILL,
        colorStroke: HIGHWAY_STROKE,
        stipple: false,
        vertices: tile.geometry,
        verticesOffset: line.vertexOffset,
        verticesLength: line.vertexLength,
      });
    }

    if (zoom > 5) {
      baker.addLines(major, HIGHWAY_MAJOR_RADIUS * zoom / 15, HIGHWAY_Z + 0.9);
    }
    if (zoom > 7) {
      baker.addLines(arterial, HIGHWAY_ARTERIAL_RADIUS * zoom / 15, HIGHWAY_Z + 0.5);
    }
    if (zoom > 10) {
      baker.addLines(minor, HIGHWAY_MINOR_RADIUS * zoom / 15, HIGHWAY_Z);
    }
  }

  private bakeLabels(tile: MbtileTile, zoom: number, baker: RenderBaker): void {
    for (const label of tile.labels) {
      let fill;
      let stroke;
      let size;
      let z;

      if (label.type === LabelType.Peak) {
        if (zoom > 12) {
          fill = TERTIARY_LABEL_FILL;
          stroke = TERTIARY_LABEL_STROKE;
          size = TERTIARY_LABEL_SIZE;
          z = 0;
        } else {
          continue;
        }
      } else if (label.type === LabelType.Country) {
        if (zoom >= 7) {
          continue;
        } else if (zoom >= 6) {
          fill = PRIMARY_LABEL_FILL;
          stroke = PRIMARY_LABEL_STROKE;
          size = PRIMARY_LABEL_SIZE;
        } else if (zoom >= 4 && label.rank < 4) {
          fill = SECONDARY_LABEL_FILL;
          stroke = SECONDARY_LABEL_STROKE;
          size = SECONDARY_LABEL_SIZE;
        } else if (label.rank === 1) {
          fill = SECONDARY_LABEL_FILL;
          stroke = SECONDARY_LABEL_STROKE;
          size = SECONDARY_LABEL_SIZE;
        } else {
          continue;
        }

        z = 0.999;
      } else if (label.type === LabelType.State) {
        if (zoom >= 8 || label.rank > 3) {
          continue;
        } else if (zoom >= 6) {
          fill = TERTIARY_LABEL_FILL;
          stroke = TERTIARY_LABEL_STROKE;
          size = TERTIARY_LABEL_SIZE;
        } else if (zoom >= 5 && label.rank === 1) {
          fill = TERTIARY_LABEL_FILL;
          stroke = TERTIARY_LABEL_STROKE;
          size = TERTIARY_LABEL_SIZE;
        } else {
          continue;
        }

        z = 0.99;
      } else if (label.type === LabelType.City) {
        if (zoom >= 9) {
          fill = SECONDARY_LABEL_FILL;
          stroke = SECONDARY_LABEL_STROKE;
          size = SECONDARY_LABEL_SIZE;
        } else if (zoom >= 7 && label.rank < 8) {
          fill = SECONDARY_LABEL_FILL;
          stroke = SECONDARY_LABEL_STROKE;
          size = SECONDARY_LABEL_SIZE;
        } else if (zoom >= 5 && label.rank === 0) {
          fill = SECONDARY_LABEL_FILL;
          stroke = SECONDARY_LABEL_STROKE;
          size = SECONDARY_LABEL_SIZE;
        } else {
          continue;
        }

        z = 0.9 - label.rank / 50;
      } else if (label.type === LabelType.Town) {
        if (zoom >= 10) {
          fill = SECONDARY_LABEL_FILL;
          stroke = SECONDARY_LABEL_STROKE;
          size = SECONDARY_LABEL_SIZE;
        } else {
          continue;
        }

        z = 0.8;
      } else {
        continue;
      }

      this.sdfNormal.plan(
          label.text,
          fill,
          stroke,
          size,
          [tile.geometry[label.positionOffset], tile.geometry[label.positionOffset + 1]],
          [0, 0],
          0,
          LABEL_Z + z,
          baker);
    }
  }
}

function renderLines<T extends {
  vertexLength: number;
  vertexOffset: number;
}>(lines: T[], fill: RgbaU32, stroke: RgbaU32, geometry: Float64Array): RenderedLine<T>[] {
  const rendered = [];
  for (const line of lines) {
    rendered.push({
      ...line,
      colorFill: fill,
      colorStroke: stroke,
      stipple: false,
      vertices: geometry,
      verticesOffset: line.vertexOffset,
      verticesLength: line.vertexLength,
    });
  }
  return rendered;
}

