import { checkArgument, checkExhaustive, checkExists } from 'js/common/asserts';
import { HashMap } from 'js/common/collections';
import { debugMode } from 'js/common/debug';
import { getUnitSystem, UnitSystem } from 'js/server/ssr_aware';

import { rgbaToUint32 } from '../common/math';
import { Area, AreaType, Boundary, Contour, Highway, HighwayType, MbtileTile, MbtileTileset, RgbaU32, TileId, Vec2, Waterway } from '../common/types';
import { Camera } from '../models/camera';
import { Line } from '../rendering/geometry';
import { RenderPlanner } from '../rendering/render_planner';
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
const CONTOUR_LABEL_FILL = rgbaToUint32(0.1, 0.1, 0.1, 1);
const CONTOUR_LABEL_STROKE = rgbaToUint32(1, 1, 1, 1);
const CONTOUR_Z = 1;
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
  waterways: RenderedLine<Waterway>[];
}

type RenderedArea = Area & {
  fill: RgbaU32;
};

type RenderedLine<T> = Line & T;

export class MbtileData extends Layer {

  private lastChange: number;
  private readonly tiles: HashMap<TileId, RenderableMbtileTile>;
  private readonly sdfRenderer: SdfPlanner;

  constructor(
      private readonly camera: Camera,
      private readonly dataService: TileDataService,
      private readonly renderer: Renderer,
      tileset: MbtileTileset,
  ) {
    super();
    this.lastChange = Date.now();
    this.tiles = new HashMap(id => `${id.x},${id.y},${id.zoom}`);
    this.sdfRenderer = new SdfPlanner(renderer);
    this.registerDisposable(this.sdfRenderer);

    this.registerDisposable(this.dataService.streamMbtiles(tileset, this));
  }

  hasDataNewerThan(time: number): boolean {
    return this.lastChange > time;
  }

  plan(viewportSize: Vec2, zoom: number, planner: RenderPlanner): void {
    const sorted = [...this.tiles].sort((a, b) => a[0].zoom - b[0].zoom);
    const lines = [];
    const boldLines = [];
    const unit = getUnitSystem();
    for (const [id, tile] of sorted) {
      if (!tile) {
        continue;
      }

      let contours;
      if (unit === 'imperial') {
        contours = tile.contoursFt;
      } else if (unit === 'metric') {
        contours = tile.contoursM;
      } else {
        throw checkExhaustive(unit);
      }

      for (const line of contours) {
        if ((zoom >= 14 && line.nthLine % 5 === 0) || line.nthLine % 10 === 0) {
          if (zoom >= 17) {
            boldLines.push(line);
          } else {
            lines.push(line);
          }

          for (let i = 0; i < line.labels.length; ++i) {
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

            const label = line.labels[i];
            this.sdfRenderer.plan(
              String(line.height),
              CONTOUR_LABEL_FILL,
              CONTOUR_LABEL_STROKE,
              0.5,
              label.position,
              [0, 0],
              label.angle,
              planner);
          }
        } else if (zoom >= 17) {
          lines.push(line);
        }
      }

      for (const {fill, polygons} of tile.areas) {
        for (const polygon of polygons) {
          planner.addTriangles(polygon.indices, polygon.vertices, fill, AREA_Z);
        }
      }

      for (const boundary of tile.boundaries) {
        if (boundary.adminLevel < zoom) {
          lines.push(boundary);
        }
      }

      planner.addLines(tile.highwayss.major, HIGHWAY_MAJOR_RADIUS * zoom / 15, HIGHWAY_Z);
      if (zoom >= 9) {
        planner.addLines(tile.highwayss.arterial, HIGHWAY_ARTERIAL_RADIUS * zoom / 15, HIGHWAY_Z);
      }
      if (zoom >= 16) {
        planner.addLines(tile.highwayss.minor, HIGHWAY_MINOR_RADIUS * zoom / 15, HIGHWAY_Z);
      }
      lines.push(...tile.waterways);
    }

    planner.addLines(
        boldLines, CONTOUR_EMPHASIZED_RADIUS, CONTOUR_Z, /* replace= */ false, /* round= */ false);
    planner.addLines(
        lines, CONTOUR_NORMAL_RADIUS, CONTOUR_Z, /* replace= */ false, /* round= */ false);
  }

  viewportBoundsChanged(viewportSize: Vec2, zoom: number): void {
    this.dataService.updateViewport(this.camera.centerPixel, viewportSize, zoom);
  }

  loadTile(id: TileId, tile: MbtileTile): void {
    this.lastChange = Date.now();

    this.tiles.set(id, {
      areas: renderAreas(tile.areas),
      boundaries: renderLines(tile.boundaries, BOUNDARY_FILL, BOUNDARY_STROKE),
      contoursFt: renderLines(tile.contoursFt, CONTOUR_FILL, CONTOUR_STROKE),
      contoursM: renderLines(tile.contoursM, CONTOUR_FILL, CONTOUR_STROKE),
      highways: [], // awkward...
      highwayss: renderHighways(tile.highways),
      waterways: renderLines(tile.waterways, WATERWAY_FILL, WATERWAY_STROKE),
    });
  }

  unloadTiles(ids: TileId[]): void {
    for (const id of ids) {
      this.tiles.delete(id);
    }
    this.lastChange = Date.now();
  }
}

function renderAreas(areas: Area[]): RenderedArea[] {
  const rendered = [];
  for (const area of areas) {
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
      color = PARK_FILL;
    } else if (area.type === AreaType.Transportation) {
      color = HIGHWAY_FILL;
    } else if (area.type === AreaType.Water) {
      color = WATER_FILL;
    }

    const constColor = color;
    if (constColor !== undefined) {
      rendered.push({
        ...area,
        fill: constColor,
      });
    }
  }
  return rendered;
}

function renderHighways(lines: Highway[]): {
  major: RenderedLine<Highway>[];
  arterial: RenderedLine<Highway>[];
  minor: RenderedLine<Highway>[];
} {
  const major: RenderedLine<Highway>[] = [];
  const arterial: RenderedLine<Highway>[] = [];
  const minor: RenderedLine<Highway>[] = [];
  for (const line of lines) {
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
    });
  }
  return {major, arterial, minor};
}

function renderLines<T extends {
  vertices: Float64Array;
}>(lines: T[], fill: RgbaU32, stroke: RgbaU32): RenderedLine<T>[] {
  const rendered = [];
  for (const line of lines) {
    rendered.push({
      ...line,
      colorFill: fill,
      colorStroke: stroke,
      stipple: false,
    });
  }
  return rendered;
}

