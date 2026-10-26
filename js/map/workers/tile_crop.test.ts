import { cropLine } from './tile_crop';

const EXTENT = 4096;

// From Macrostrat's units layer in tile 6/10/22.
test('drops a ring that only touches the tile at one point', () => {
  const [geometry, starts] =
      cropLine([0, 60, -10, 66, -16, 62, -16, 60], [0], EXTENT, /* loop= */ true);

  expect(geometry).toEqual([0, 60]);
  expect(starts).toEqual([0]);
});

test('continues a line that leaves and reenters at the same edge point', () => {
  const [geometry, starts] =
      cropLine([5, 5, 0, 5, -5, 5, 0, 5, 5, 6], [0], EXTENT, /* loop= */ false);

  expect(geometry).toEqual([5, 5, 0, 5, 5, 6]);
  expect(starts).toEqual([0]);
});
