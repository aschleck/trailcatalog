import { Controller, Response } from 'external/dev_april_corgi+/js/corgi/controller';

import { CollectionModel } from '../model/collection_model';
import { FEATURE_SAVED } from '../model/events';
import { FeatureStore } from '../model/feature_store';
import { EditableFeature, FeatureData } from '../model/features';
import { adoptImported, getObjectTitle, withDefaults } from '../model/schema';
import { CollectionSchema } from '../workers/collection_schema';
import { InspectedGeometry, InspectedObject, OsmElement } from './feature_list';

interface Args {
  object: InspectedObject;
}

type Deps = typeof SaveToCollectionController.deps;

/** Copies an inspected OpenStreetMap object into the open collection. */
export class SaveToCollectionController extends Controller<Args, Deps, HTMLElement, undefined> {

  static deps() {
    return {
      models: {
        collection: CollectionModel,
      },
    };
  }

  private object: InspectedObject;
  private readonly store: FeatureStore;

  constructor(response: Response<SaveToCollectionController>) {
    super(response);
    this.object = response.args.object;
    this.store = response.deps.models.collection.store;
  }

  updateArgs(newArgs: Args): void {
    this.object = newArgs.object;
  }

  clicked(): void {
    const osm = this.object.osm;
    if (!osm || this.store.isReadOnly()) {
      return;
    }

    const copied =
        copyOsmObject(
            this.object.geometry(),
            osm,
            getObjectTitle(this.object.schema, this.object),
            this.store.schema());
    if (copied.length === 0) {
      return;
    }
    this.store.apply(copied.map(f => ({id: f.id, before: undefined, after: f})));
    this.trigger(FEATURE_SAVED, {id: copied[0].id});
  }
}

/**
 * Returns new features copying an OpenStreetMap object, the one to select first. A relation with
 * several runs or exterior rings comes back as a folder followed by a feature for each.
 */
export function copyOsmObject(
    geometry: InspectedGeometry,
    osm: OsmElement,
    name: string|undefined,
    schema: CollectionSchema): EditableFeature[] {
  if (geometry.parts.length === 0) {
    return [];
  }

  const data: FeatureData = {description: `https://www.openstreetmap.org/${osm.type}/${osm.id}`};
  if (name) {
    data.name = name;
  }
  const features = geometry.parts.map(part => newFeature(geometry.kind, part, {...data}));
  const top: EditableFeature =
      features.length === 1
          ? features[0]
          : {kind: 'folder', id: crypto.randomUUID(), version: 0n, data: name ? {name} : {}};
  const copied = top === features[0] ? features : [top, ...features];
  for (const feature of copied) {
    if (feature !== top) {
      feature.data.folder_id = top.id;
    }
    adoptImported(schema, feature);
    feature.data = withDefaults(schema, feature);
  }
  return copied;
}

function newFeature(kind: 'line'|'point'|'polygon', latLngE7: Int32Array, data: FeatureData):
    EditableFeature {
  const id = crypto.randomUUID();
  if (kind === 'point') {
    return {
      kind,
      id,
      version: 0n,
      data,
      latE7: latLngE7[0],
      lngE7: latLngE7[1],
      elevationCentimeters: undefined,
    };
  } else if (kind === 'line') {
    return {
      kind,
      id,
      version: 0n,
      data,
      latLngE7,
      elevationCentimeters: undefined,
      timeSeconds: undefined,
    };
  }
  return {kind, id, version: 0n, data, latLngE7};
}
