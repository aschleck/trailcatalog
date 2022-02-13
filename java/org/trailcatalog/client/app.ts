import { S1Angle, S2LatLng, S2LatLngRect, SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
//import { SimpleS2 } from '../s2/SimpleS2';

console.log('hello!');

const viewport = S2LatLngRect.fromPoint(S2LatLng.fromDegrees(37.424862, -122.154853)).expandedByDistance(S1Angle.degrees(0.01));

const cells = SimpleS2.cover(viewport);
console.log(cells);
for (let i = 0; i < cells.size(); ++i) {
  const cell = cells.getAtIndex(i);
  fetch(`/api/fetch_cell/${cell.toToken()}`).then(response => {
    console.log(response);
  });
}
