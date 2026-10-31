// 2 on every screen. Below 2 we supersample because the canvas has no antialiasing. Phones report 3,
// which costs 2.25x the fill of 2 and, because MapController#idle sizes its tile bounds in canvas
// pixels, about 1.8x the tile requests.
export const DPI = 2;

export const DPI_ZOOM = Math.log2(DPI) - 1;
