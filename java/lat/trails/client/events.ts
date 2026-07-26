import { declareEvent } from 'external/dev_april_corgi+/js/corgi/events';
import { RawUuid } from 'js/map/common/types';

import { Data } from './workers/collection_loader';

export const HOVER_CHANGED = declareEvent<{
  target: {
    id: RawUuid;
    data: Data;
  }|undefined;
}>('hover_changed');

