export const DPI =
    new URLSearchParams(window.location.search).get('dpi') === 'true'
        ? window.devicePixelRatio ?? 1
        : 1;

