import { RgbaU32 } from 'js/map/common/types';
import { LinePattern } from 'js/map/rendering/line_program';
import { Z_USER_DATA, Z_USER_DATA_FILL, Z_USER_DATA_HALO } from 'js/map/z';

import { Data, LineStyle, PointStyle, PolygonStyle, Styler } from './collection_loader';
import {
  CollectionSchema,
  darken,
  getCasing,
  getHalo,
  haloRadiusPx,
  lineLook,
  lineRadiusPx,
  parseColor,
  pointLook,
  polygonLook,
} from './collection_schema';

// Points draw as circles here, whatever their icon, ringed so that pale fills read over the
// basemap.
const POINT_STROKE = 0x000000FF as RgbaU32;

/**
 * Styles a collection's objects by resolving each one's look from the schema, as FeatureLayer does
 * for editable features. Objects that look alike share a style so the loader batches them.
 */
export class SchemaStyler implements Styler {

  private readonly lines = new Map<string, LineStyle>();
  private readonly points = new Map<string, PointStyle>();
  private readonly polygons = new Map<string, PolygonStyle>();

  constructor(private readonly schema: CollectionSchema) {}

  line(data: Data): LineStyle|undefined {
    const look = lineLook(this.schema, data);
    if (!look) {
      return undefined;
    }
    const halo = getHalo(look);
    return this.stroke(
        parseColor(look.stroke),
        getCasing(look),
        look.widthPx,
        look.pattern,
        halo && {fill: halo, radius: haloRadiusPx(look.widthPx), z: Z_USER_DATA_HALO});
  }

  point(data: Data): PointStyle|undefined {
    const look = pointLook(this.schema, data);
    if (!look) {
      return undefined;
    }
    const fill = parseColor(look.fill);
    return cached(this.points, `${fill},${look.radiusPx}`, () => ({
      filters: [],
      fill,
      stroke: POINT_STROKE,
      radius: look.radiusPx,
      z: Z_USER_DATA,
    }));
  }

  // A clear stroke, which importers give their polygons, draws no outline.
  polygon(data: Data): PolygonStyle|undefined {
    const look = polygonLook(this.schema, data);
    if (!look) {
      return undefined;
    }
    const fill = parseColor(look.fill);
    const stroke = parseColor(look.stroke);
    const pattern = look.pattern;
    const outline =
        (stroke & 0xFF) === 0
            ? undefined
            : this.stroke(stroke, darken(stroke), look.widthPx, pattern, undefined);
    return cached(
        this.polygons,
        `${fill},${outline ? `${stroke},${look.widthPx},${pattern}` : ''}`,
        () => ({filters: [], fill, outline, z: Z_USER_DATA_FILL}));
  }

  private stroke(
      fill: RgbaU32,
      stroke: RgbaU32,
      widthPx: number,
      pattern: LinePattern,
      halo: LineStyle['halo']): LineStyle {
    const key = `${fill},${stroke},${widthPx},${pattern},${halo?.fill ?? ''}`;
    return cached(this.lines, key, () => ({
      filters: [],
      minZoom: 0,
      maxZoom: Infinity,
      fill,
      halo,
      pattern,
      radius: lineRadiusPx(widthPx),
      stroke,
      z: Z_USER_DATA,
    }));
  }
}

function cached<S>(styles: Map<string, S>, key: string, make: () => S): S {
  let style = styles.get(key);
  if (!style) {
    style = make();
    styles.set(key, style);
  }
  return style;
}
