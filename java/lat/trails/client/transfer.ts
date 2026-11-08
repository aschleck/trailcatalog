import { DialogService } from 'external/dev_april_corgi+/js/emu/dialog';

import { S2LatLng } from 'java/org/trailcatalog/s2';

import { CollectionModel } from './model/collection_model';
import { toGeoJson, toGpx } from './model/exporter';
import { Change } from './model/feature_store';
import { EditableFeature, EditableLine } from './model/features';
import { getImageIcon, uploadImage } from './model/images';
import { parseImport } from './model/importer';
import { adoptImported, channelOf, withDefaults } from './model/schema';
import { getPositionAt } from './model/tracks';
import { ImportFailedDialog } from './ui/dialogs';
import { ExportDialog } from './ui/export_dialog';
import { ToastService } from './ui/toasts';
import { CollectionSchema, getField } from './workers/collection_schema';

const UPLOADS_IN_FLIGHT = 2;

export interface Transfer {
  collection: CollectionModel;
  dialog: DialogService;
  toast: ToastService;
  // Where a photo with no location goes when it wasn't dropped on the map
  center: () => S2LatLng;
}

export function pickImportFiles(transfer: Transfer): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.geojson,.gpx,.json,application/geo+json,application/gpx+xml,image/*';
  input.multiple = true;
  input.addEventListener('change', () => {
    importFiles(transfer, Array.from(input.files ?? []));
  });
  input.click();
}

/**
 * Imports files as one edit, so that a single undo takes back everything they added. Photos upload
 * UPLOADS_IN_FLIGHT at a time so that one person's drop leaves the API server's other encodes to
 * everybody else.
 */
export function importFiles(transfer: Transfer, files: File[], dropped?: S2LatLng): void {
  const {collection, dialog, toast} = transfer;
  const store = collection.store;
  const generation = collection.getGeneration();
  const stale = () => generation !== collection.getGeneration();
  const results: Array<{changes: Change[]; failed?: string}> = [];
  let imported = 0;
  const describe = (verb: string, count: number) =>
      files.length === 1
          ? `${verb} ${files[0].name}`
          : `${verb} ${count} of ${files.length} files`;
  const progress = toast.start(describe('Importing', 0), /* fraction= */ 0);
  const importAll = (queue: File[], tracks: EditableLine[]) => {
    const importNext = async (): Promise<void> => {
      for (let file = queue.shift(); file && !stale(); file = queue.shift()) {
        const result = await importOne(transfer, file, dropped, tracks);
        results.push(result);
        if (!result.failed) {
          imported += 1;
        }
        progress.update(describe('Imported', imported), results.length / files.length);
      }
    };
    return Promise.all(Array.from({length: UPLOADS_IN_FLIGHT}, importNext));
  };
  // Tracks import first so that photos dropped alongside them can be placed along them.
  const isImage = (file: File) => file.type.startsWith('image/');
  importAll(files.filter(f => !isImage(f)), []).then(() => {
    const tracks = [
      ...store.lines(),
      ...results.flatMap(r => r.changes.flatMap(c => c.after?.kind === 'line' ? [c.after] : [])),
    ];
    return importAll(files.filter(isImage), tracks);
  }).then(() => {
    // Another collection was opened meanwhile, and these changes belong to the one before.
    if (stale()) {
      progress.dismiss();
      return;
    }
    store.apply(results.flatMap(r => r.changes));
    const failed = results.flatMap(r => r.failed ? [r.failed] : []);
    if (imported === 0) {
      progress.dismiss();
    } else if (failed.length > 0) {
      progress.finish(describe('Imported', imported));
    } else {
      progress.finish(files.length === 1 ? describe('Imported', 1) : `Imported ${imported} files`);
    }
    if (failed.length > 0) {
      dialog.display(ImportFailedDialog({files: failed})).catch(() => {});
    }
  });
}

export function exportFiles({collection, dialog}: Transfer, name: string|undefined): void {
  const schema = collection.store.schema();
  dialog.display(ExportDialog({
    features: [...collection.store.all()],
    schema,
    onExport: (format, features) => {
      if (format === 'gpx') {
        download(toGpx(features, schema), `${name || 'trails'}.gpx`, 'application/gpx+xml');
      } else {
        download(
            toGeoJson(features, schema), `${name || 'trails'}.geojson`, 'application/geo+json');
      }
    },
  })).catch(() => {});
}

function download(text: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// Reports the file's name when it yielded nothing, so that importing several files names every one
// that failed in a single dialog.
function importOne(
    transfer: Transfer,
    file: File,
    dropped: S2LatLng|undefined,
    tracks: EditableLine[]): Promise<{changes: Change[]; failed?: string}> {
  const changes =
      file.type.startsWith('image/')
          ? importImage(transfer, file, dropped, tracks)
          : importFeatures(transfer.collection.store.schema(), file);
  return changes.then(
      changes => changes.length > 0 ? {changes} : {changes, failed: file.name},
      e => {
        console.error(e);
        return {changes: [], failed: file.name};
      });
}

// Wraps the file's features in a folder named after it, so that importing a pile of files does not
// bury the collection's root.
function importFeatures(schema: CollectionSchema, file: File): Promise<Change[]> {
  return file.text().then(text => {
    const features = parseImport(text);
    // A GPX carrying only routes parses and still leaves nothing to draw, which looks the same to
    // somebody who picked a file and watched the map not change.
    if (features.length === 0) {
      return [];
    }

    const folder: EditableFeature = {
      kind: 'folder',
      id: crypto.randomUUID(),
      version: 0n,
      data: {name: file.name.replace(/\.[^.]*$/, '')},
    };
    for (const feature of features) {
      feature.data.folder_id ??= folder.id;
      adoptImported(schema, feature);
      feature.data = withDefaults(schema, feature);
    }
    return [folder, ...features].map(f => ({id: f.id, before: undefined, after: f}));
  });
}

// Makes a point that shows the photo where it was geotagged, or else where a track was when the
// photo was taken, or else where it was dropped on the map, or else in the middle of the map.
function importImage(
    {collection, center}: Transfer,
    file: File,
    dropped: S2LatLng|undefined,
    tracks: EditableLine[]): Promise<Change[]> {
  const field = getImageIconField(collection.store.schema());
  if (field === undefined) {
    return Promise.reject(new Error('Points have no icon field to show a photo in'));
  }
  return collection.current()
      .then(id => uploadImage(id, file))
      .then(({capturedEpochSeconds, id, location}) => {
        const tracked =
            location === undefined && capturedEpochSeconds !== undefined
                ? getPositionAt(tracks, Number(capturedEpochSeconds))
                : undefined;
        const at =
            location
                ? S2LatLng.fromDegrees(location.latDegrees, location.lngDegrees)
                : dropped ?? center();
        const point: EditableFeature = {
          kind: 'point',
          id: crypto.randomUUID(),
          version: 0n,
          data: {[field]: getImageIcon(id)},
          latE7: tracked?.latE7 ?? Math.round(at.latDegrees() * 1e7),
          lngE7: tracked?.lngE7 ?? Math.round(at.lngDegrees() * 1e7),
          elevationCentimeters: tracked?.elevationCentimeters,
        };
        point.data = withDefaults(collection.store.schema(), point);
        return [{id: point.id, before: undefined, after: point}];
      });
}

// Returns the field that points take their icon from, if it's a field of type icon. Only then can a
// photo become a point's icon.
function getImageIconField(schema: CollectionSchema): string|undefined {
  const channel = channelOf(schema, 'point', 'icon');
  return channel.kind === 'field' && getField(schema, 'point', channel.key)?.type === 'icon'
      ? channel.key
      : undefined;
}
