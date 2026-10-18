import { RgbaU32 } from 'js/map/common/types';
import { Z_USER_DATA } from 'js/map/z';

import { Data, LineStyle, PointStyle, PolygonStyle, Styler } from './collection_loader';
import {
  CollectionSchema,
  darken,
  lineLook,
  lineRadiusPx,
  parseColor,
  pointLook,
  polygonLook,
  toStipple,
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
    const fill = parseColor(look.stroke);
    const stipple = toStipple(look.pattern);
    return cached(this.lines, `${fill},${look.widthPx},${stipple}`, () => ({
      filters: [],
      minZoom: 0,
      maxZoom: Infinity,
      fill,
      stroke: darken(fill),
      radius: lineRadiusPx(look.widthPx),
      stipple,
      z: Z_USER_DATA,
    }));
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

  polygon(data: Data): PolygonStyle|undefined {
    const look = polygonLook(this.schema, data);
    if (!look) {
      return undefined;
    }
    const fill = parseColor(look.fill);
    return cached(this.polygons, String(fill), () => ({filters: [], fill, z: Z_USER_DATA}));
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
