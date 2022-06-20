import { S2CellNumber } from '../common/types';

export const DETAIL_ZOOM_THRESHOLD = 10;

// There is no S2 cell ID 0, so we overload it for this.
export const PIN_CELL_ID = 0 as S2CellNumber;
