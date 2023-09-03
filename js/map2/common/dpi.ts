export const DPI = Math.max(window.devicePixelRatio ?? 1, 2);

export const DPI_ZOOM = Math.log2(DPI) - 1;
