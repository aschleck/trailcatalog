import { Collection, Role } from 'trails_lat/proto/data_pb';

export interface CollectionData {
  description?: string;
}

export function canEdit(collection: Collection|undefined): collection is Collection {
  return collection?.role === Role.OWNER || collection?.role === Role.WRITE;
}

export function descriptionOf(collection: Collection|undefined): string {
  const data = parseCollectionData(collection);
  return typeof data.description === 'string' ? data.description : '';
}

function parseCollectionData(collection: Collection|undefined): CollectionData {
  return collection?.data ? JSON.parse(collection.data) : {};
}
