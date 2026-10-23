export const Z_BOTTOM = 0;
export const Z_BASE_TERRAIN = 1;
// Over the landcover fills, which stack thick enough to hide anything under them, and under water
export const Z_BASE_ELEVATION = Z_BASE_TERRAIN + 0.9;
export const Z_BASE_WATER = 2;
export const Z_BASE_SATELLITE = 3;
export const Z_BASE_SLOPE = 4;
export const Z_OVERLAY_TERRAIN = 10;
export const Z_OVERLAY_TRANSPORTATION = 12;
export const Z_OVERLAY_TEXT = 13;
export const Z_USER_DATA = 100;
// Under the user's lines and polygon outlines, so that a fill never hides one
export const Z_USER_DATA_FILL = Z_USER_DATA - 0.5;
// Over the fills and under the lines it surrounds, including their casings at Z_USER_DATA - 0.1
export const Z_USER_DATA_HALO = Z_USER_DATA - 0.25;
export const Z_USER_DATA_HIGHLIGHT = 101;
export const Z_EDITING = 200;

// don't exceed 1000 without changing program.ts.
