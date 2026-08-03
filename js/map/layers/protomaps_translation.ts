import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';

import { Style } from '../workers/mbtile_loader';

// Translates a style written against MapTiler's OpenMapTiles schema into one that draws protomaps
// v4 tiles.
//
// The two schemas cut the world up differently. OpenMapTiles splits by theme and names a feature
// with class, so an airport's outline and its runways both live in aeroway. Protomaps splits by
// geometry and names a feature with kind plus kind_detail, so the outline is a landuse polygon and
// the runways are lines in roads. That means a layer can land in more than one protomaps layer, and
// several layers can land in the same one.
//
// https://docs.protomaps.com/basemaps/layers

type LayerStyle = Style['layers'][number];
type Match = LayerStyle['lines'][number]['filters'][number];

// The protomaps attribute and values one OpenMapTiles class becomes. No values means protomaps
// doesn't carry the class at all.
interface ClassTranslation {
  key: string;
  values: string[];
}

interface LayerTranslation {
  // The protomaps layer each kind of geometry moves to. Geometry with no layer here drops.
  lines?: string;
  lineTexts?: string;
  points?: string;
  polygons?: string;
  classes?: ReadonlyMap<string, ClassTranslation>;
  // Protomaps names for the attributes that aren't class.
  renames?: ReadonlyMap<string, string>;
  // Attributes whose filter is redundant because protomaps never emits what it was excluding.
  redundant?: ReadonlySet<string>;
  // Attributes protomaps has no answer for.
  inexpressible?: ReadonlySet<string>;
  // Protomaps names for the keys a line text reads.
  texts?: ReadonlyMap<string, string>;
}

// Protomaps carries a road's OpenMapTiles class on kind_detail, which is the raw highway or railway
// value, so a link keeps the _link suffix and a subway says subway. Construction has no kind_detail
// of its own.
const ROAD_CLASSES: ReadonlyMap<string, ClassTranslation> = new Map([
  ['motorway', {key: 'kind_detail', values: ['motorway', 'motorway_link']}],
  ['trunk', {key: 'kind_detail', values: ['trunk', 'trunk_link']}],
  ['primary', {key: 'kind_detail', values: ['primary', 'primary_link']}],
  ['secondary', {key: 'kind_detail', values: ['secondary', 'secondary_link']}],
  ['tertiary', {key: 'kind_detail', values: ['tertiary', 'tertiary_link']}],
  ['minor', {key: 'kind_detail', values: ['residential', 'unclassified', 'living_street', 'road']}],
  ['service', {key: 'kind_detail', values: ['service']}],
  ['rail', {key: 'kind_detail', values: ['rail', 'narrow_gauge', 'preserved', 'funicular']}],
  ['transit', {key: 'kind_detail', values: ['subway', 'light_rail', 'tram', 'monorail']}],
  ['motorway_construction', {key: 'kind_detail', values: []}],
  ['primary_construction', {key: 'kind_detail', values: []}],
  ['secondary_construction', {key: 'kind_detail', values: []}],
  ['minor_construction', {key: 'kind_detail', values: []}],
]);

const LAYERS: ReadonlyMap<string, LayerTranslation> = new Map<string, LayerTranslation>([
  ['aeroway', {
    lines: 'roads',
    polygons: 'landuse',
    classes: new Map([
      ['runway', {key: 'kind_detail', values: ['runway']}],
      ['taxiway', {key: 'kind_detail', values: ['taxiway']}],
      ['aerodrome', {key: 'kind', values: ['aerodrome']}],
      // Protomaps takes aeroway=aerodrome, runway, and taxiway into landuse and leaves the apron
      // out, so the pavement between the gates and the taxiways doesn't draw.
      ['apron', {key: 'kind', values: []}],
    ]),
  }],
  ['boundary', {
    lines: 'boundaries',
    renames: new Map([['admin_level', 'kind_detail']]),
    // Protomaps skips a way tagged maritime=yes, so the offshore sovereignty line never arrives.
    // See Boundaries.java#processOsm.
    redundant: new Set(['maritime']),
  }],
  // Contours come from the trailcatalog tiles, and protomaps has no layer to draw them from.
  ['contour', {}],
  ['contour_ft', {}],
  ['globallandcover', {
    polygons: 'landcover',
    classes: new Map([
      ['crop', {key: 'kind', values: ['farmland']}],
      ['grass', {key: 'kind', values: ['grassland']}],
      ['scrub', {key: 'kind', values: ['scrub']}],
      ['forest', {key: 'kind', values: ['forest']}],
      ['tree', {key: 'kind', values: ['forest']}],
      ['snow', {key: 'kind', values: ['glacier']}],
    ]),
  }],
  // The OpenMapTiles landcover layer is per-object ground cover, which protomaps keeps in landuse.
  // Its landcover layer is the Daylight raster-derived cover that globallandcover matches.
  ['landcover', {
    polygons: 'landuse',
    classes: new Map([
      ['wetland', {key: 'kind', values: ['wetland']}],
      ['grass', {key: 'kind', values: ['grass', 'grassland', 'meadow']}],
      ['wood', {key: 'kind', values: ['wood', 'forest']}],
      ['sand', {key: 'kind', values: ['sand']}],
      ['state_beach', {key: 'kind', values: ['beach']}],
      ['ice', {key: 'kind', values: ['glacier']}],
    ]),
  }],
  ['park', {
    points: 'pois',
    polygons: 'landuse',
    classes: new Map([
      ['national_park', {key: 'kind', values: ['national_park']}],
      ['wilderness_area', {key: 'kind', values: ['protected_area']}],
      ['state_wilderness', {key: 'kind', values: ['protected_area']}],
      ['nature_reserve', {key: 'kind', values: ['nature_reserve']}],
      ['open_space_preserve', {key: 'kind', values: ['nature_reserve']}],
      ['city_park', {key: 'kind', values: ['park']}],
      ['county_park', {key: 'kind', values: ['park']}],
      ['regional_park', {key: 'kind', values: ['park']}],
      ['state_park', {key: 'kind', values: ['park']}],
    ]),
  }],
  ['place', {
    points: 'places',
    classes: new Map([
      ['country', {key: 'kind_detail', values: ['country']}],
      ['province', {key: 'kind_detail', values: ['province']}],
      ['state', {key: 'kind_detail', values: ['state']}],
      ['city', {key: 'kind_detail', values: ['city']}],
      ['town', {key: 'kind_detail', values: ['town']}],
      ['village', {key: 'kind_detail', values: ['village']}],
      ['suburb', {key: 'kind_detail', values: ['neighbourhood', 'quarter']}],
    ]),
    // OpenMapTiles ranks a place by prominence and protomaps names the zoom its label is meant to
    // appear at. Both count up as the place gets smaller and both run about 1 to 15, so the
    // thresholds carry over: a city ranked under 8 is about a city labeled by zoom 8.
    renames: new Map([['rank', 'min_zoom']]),
  }],
  ['transportation', {
    lines: 'roads',
    classes: ROAD_CLASSES,
  }],
  ['transportation_name', {
    lineTexts: 'roads',
    classes: ROAD_CLASSES,
    // Protomaps only fills shield_text for a route that carries a shield, so the shield_text text
    // with its name fallback covers both of the OpenMapTiles rules by itself. The rule that reads
    // network to find the unsigned routes has nothing to read and drops.
    inexpressible: new Set(['network']),
    texts: new Map([['ref', 'shield_text']]),
  }],
  ['water', {
    polygons: 'water',
  }],
  // Protomaps hangs a lake's name on the polygon rather than on a point, and the renderer only
  // labels points and lines, so this ends up labeling rivers and canals.
  ['water_name', {
    lineTexts: 'water',
    points: 'water',
  }],
  ['waterway', {
    lines: 'water',
    lineTexts: 'water',
    classes: new Map([
      ['river', {key: 'kind', values: ['river']}],
      ['stream', {key: 'kind', values: ['stream']}],
      ['canal', {key: 'kind', values: ['canal']}],
    ]),
  }],
]);

/** Rewrites a MapTiler OpenMapTiles style to read protomaps v4 tiles. */
export function toProtomaps(style: Style): Style {
  const translated: LayerStyle[] = [];
  for (const layer of style.layers) {
    translated.push(...translateLayer(layer));
  }
  return {layers: merge(translated)};
}

function translateLayer(layer: LayerStyle): LayerStyle[] {
  const translation = LAYERS.get(layer.layerName);
  if (!translation) {
    throw new Error(`Add a protomaps translation for the OpenMapTiles layer ${layer.layerName}`);
  }

  const targets = new Map<string, LayerStyle>();
  const target = (layerName: string|undefined) => {
    if (!layerName) {
      return undefined;
    }
    let existing = targets.get(layerName);
    if (!existing) {
      existing = {
        layerName,
        minZoom: layer.minZoom,
        maxZoom: layer.maxZoom,
        lineTexts: [],
        lines: [],
        points: [],
        polygons: [],
      };
      targets.set(layerName, existing);
    }
    return existing;
  };

  const lines = target(translation.lines);
  if (lines) {
    for (const line of layer.lines) {
      const filters = translateFilters(line.filters, layer.layerName, translation);
      if (filters) {
        lines.lines.push({...line, filters});
      }
    }
  }

  const lineTexts = target(translation.lineTexts);
  if (lineTexts) {
    for (const lineText of layer.lineTexts) {
      const filters = translateFilters(lineText.filters, layer.layerName, translation);
      if (filters) {
        lineTexts.lineTexts.push({
          ...lineText,
          filters,
          preferred: translation.texts?.get(lineText.preferred) ?? lineText.preferred,
          fallback: translation.texts?.get(lineText.fallback) ?? lineText.fallback,
        });
      }
    }
  }

  const points = target(translation.points);
  if (points) {
    for (const point of layer.points) {
      const filters = translateFilters(point.filters, layer.layerName, translation);
      if (filters) {
        points.points.push({...point, filters});
      }
    }
  }

  const polygons = target(translation.polygons);
  if (polygons) {
    for (const polygon of layer.polygons) {
      const filters = translateFilters(polygon.filters, layer.layerName, translation);
      if (filters) {
        polygons.polygons.push({...polygon, filters});
      }
    }
  }

  return [...targets.values()];
}

// Returns the protomaps filters for one style entry, or undefined if the entry has to go because
// protomaps can't answer what it asks. Dropping only the filter would draw more than the style
// asked for.
function translateFilters(
    filters: Match[], layerName: string, translation: LayerTranslation): Match[]|undefined {
  const translated: Match[] = [];
  for (const filter of filters) {
    if (filter.match === 'always') {
      translated.push(filter);
      continue;
    }

    if (filter.key === 'class') {
      if (filter.match !== 'string_in' && filter.match !== 'string_equals') {
        throw new Error(`Only a string filter names a class, got ${filter.match}`);
      }

      const classes = checkExists(translation.classes);
      const names = filter.match === 'string_in' ? filter.value : [filter.value];
      let key = undefined;
      const values: string[] = [];
      for (const name of names) {
        const mapped = classes.get(name);
        if (!mapped) {
          throw new Error(`Add a protomaps translation for the ${layerName} class ${name}`);
        } else if (mapped.values.length === 0) {
          continue;
        } else if (key !== undefined && key !== mapped.key) {
          throw new Error(
              `${layerName} classes ${names.join(', ')} land on both ${key} and ${mapped.key}, and`
                  + ` a filter only reads one key`);
        }
        key = mapped.key;
        values.push(...mapped.values);
      }

      if (values.length === 0) {
        return undefined;
      }
      translated.push({match: 'string_in', key: checkExists(key), value: values});
    } else if (translation.redundant?.has(filter.key)) {
      continue;
    } else if (translation.inexpressible?.has(filter.key)) {
      return undefined;
    } else {
      const renamed = translation.renames?.get(filter.key);
      if (!renamed) {
        throw new Error(`Add a protomaps translation for the ${layerName} attribute ${filter.key}`);
      }
      translated.push({...filter, key: renamed});
    }
  }
  return translated;
}

// Folds layers that share a name into disjoint zoom bands, because the loader draws a tile layer
// with the first style whose band holds the zoom (see mbtile_loader.ts#load) and the translation
// routinely lands two layers on one, like aeroway and transportation both on roads.
function merge(layers: LayerStyle[]): LayerStyle[] {
  const byName = new Map<string, LayerStyle[]>();
  for (const layer of layers) {
    const existing = byName.get(layer.layerName);
    if (existing) {
      existing.push(layer);
    } else {
      byName.set(layer.layerName, [layer]);
    }
  }

  const merged: LayerStyle[] = [];
  for (const [layerName, group] of byName) {
    const bounds =
        [...new Set(group.flatMap(l => [l.minZoom, l.maxZoom]))].sort((a, b) => a - b);
    for (let i = 0; i < bounds.length - 1; ++i) {
      const minZoom = bounds[i];
      const maxZoom = bounds[i + 1];
      const covering = group.filter(l => l.minZoom <= minZoom && maxZoom <= l.maxZoom);
      const band = {
        layerName,
        minZoom,
        maxZoom,
        lineTexts: covering.flatMap(l => l.lineTexts),
        lines: covering.flatMap(l => l.lines),
        points: covering.flatMap(l => l.points),
        polygons: covering.flatMap(l => l.polygons),
      };
      if (band.lineTexts.length > 0
          || band.lines.length > 0
          || band.points.length > 0
          || band.polygons.length > 0) {
        merged.push(band);
      }
    }
  }
  return merged;
}
