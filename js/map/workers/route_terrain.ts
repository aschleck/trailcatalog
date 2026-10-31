/**
 * The kind of ground a line runs over. A route between two ends on the same kind stays on that
 * kind, so that a hike from above a waterfall to below it doesn't follow the river down it.
 * Aerial is a lift, closed is a way nobody may walk, and snow is a piste. Undefined is any kind,
 * for lines a person drew.
 */
export type Terrain = 'aerial'|'closed'|'land'|'snow'|'water';

// Indexed by the byte that packed lines store
export const TERRAINS: ReadonlyArray<Terrain|undefined> =
    [undefined, 'aerial', 'closed', 'land', 'snow', 'water'];

// One bit per kind so that a route can allow several
export const ANY = 0;
const AERIAL = 1;
const CLOSED = 2;
const LAND = 4;
const SNOW = 8;
const WATER = 16;
const TERRAIN_CODES =
    {aerial: AERIAL, closed: CLOSED, land: LAND, snow: SNOW, water: WATER} as const;

// The terrain a route may use when one of its ends is on each kind
const ALLOWED_FROM = {
  // A route from a lift walks on from the station.
  aerial: AERIAL | LAND,
  // A route from a closed way leaves it at the first junction.
  closed: CLOSED | LAND,
  // Land leaves out lifts because most charge a fare, pistes because a hiker can't count on
  // walking one, and closed ways because nobody may walk them.
  land: LAND,
  // A skier already holds a lift ticket.
  snow: AERIAL | SNOW,
  water: WATER,
} as const;

export function getTerrainCode(terrain: Terrain|undefined): number {
  return terrain ? TERRAIN_CODES[terrain] : ANY;
}

// The terrain a route between two ends may use, or ANY when it may use everything. Ends on
// different kinds need both, and an end on a line of any kind agrees with whatever the other is on.
export function getAllowedTerrain(from: Terrain|undefined, to: Terrain|undefined): number {
  return (from ? ALLOWED_FROM[from] : ANY) | (to ? ALLOWED_FROM[to] : ANY);
}

export function isTerrainAllowed(code: number, allowed: number): boolean {
  return allowed === ANY || code === ANY || (code & allowed) !== 0;
}
