import { Collection } from 'trails_lat/proto/data_pb';

export interface CollectionData {
  description?: string;
}

export function descriptionOf(collection: Collection|undefined): string {
  const data = parseCollectionData(collection);
  return typeof data.description === 'string' ? data.description : '';
}

function parseCollectionData(collection: Collection|undefined): CollectionData {
  return collection?.data ? JSON.parse(collection.data) : {};
}
