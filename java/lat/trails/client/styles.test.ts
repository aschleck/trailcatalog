import { WayCategory } from 'java/org/trailcatalog/models/categories';

// The basemap styles read the page language when they load, which outside a browser comes from the
// server side render.
(globalThis as any).SERVER_SIDE_RENDER = {language: () => 'en'};
let getDrawnCategories: typeof import('./styles').getDrawnCategories;
let OSM_WAYS: typeof import('./styles').OSM_WAYS;

beforeAll(async () => {
  ({getDrawnCategories, OSM_WAYS} = await import('./styles'));
});

test('service roads are not drawn below zoom 13', () => {
  const below = checkDefined(getDrawnCategories(OSM_WAYS, 10, 12));
  expect(below).not.toContain(WayCategory.ROAD_SERVICE);
  expect(below).toContain(WayCategory.ROAD_RESIDENTIAL);

  const above = checkDefined(getDrawnCategories(OSM_WAYS, 13, 14));
  expect(above).toContain(WayCategory.ROAD_SERVICE);
});

test('a line with no type filter draws everything', () => {
  const style = {
    ...OSM_WAYS,
    lines: [{...OSM_WAYS.lines[0], filters: [], minZoom: 0, maxZoom: 31}],
  };
  expect(getDrawnCategories(style, 10, 12)).toBeUndefined();
});

test('categories under another drawn category are left out', () => {
  const style = {
    ...OSM_WAYS,
    lines: [
      {
        ...OSM_WAYS.lines[0],
        filters: [{
          match: 'category_in' as const,
          key: 'type',
          value: [WayCategory.ROAD_SERVICE, WayCategory.ROAD],
        }],
        minZoom: 0,
        maxZoom: 31,
      },
    ],
  };
  expect(getDrawnCategories(style, 10, 12)).toEqual([WayCategory.ROAD]);
});

function checkDefined<T>(value: T|undefined): T {
  expect(value).toBeDefined();
  return value as T;
}
