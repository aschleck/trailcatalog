import { declareEvent } from 'js/corgi/events';

export const ACTION = declareEvent<{}>('action');
export const CHANGED = declareEvent<{value: string}>('changed');

