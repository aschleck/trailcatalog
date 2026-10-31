import { RawUuid, Vec2 } from 'js/map/common/types';

import { Data } from './workers/collection_types';

export interface Point {
  id: RawUuid;
  // The OSM node id and PointCategory, plus the name when the node has one
  data: Data;
  // Mercator
  position: Vec2;
}
