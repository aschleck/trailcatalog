import { checkExhaustive, checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { Future, resolvedFuture } from 'external/dev_april_corgi+/js/common/futures';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { Controller, Response } from 'external/dev_april_corgi+/js/corgi/controller';
import { CorgiEvent, DOM_MOUSE, DOM_POINTER } from 'external/dev_april_corgi+/js/corgi/events';
import { HistoryService } from 'external/dev_april_corgi+/js/corgi/history/history_service';
import { invalidateCache } from 'external/dev_april_corgi+/js/data/caching';
import { DialogService } from 'external/dev_april_corgi+/js/emu/dialog';
import { ACTION, CHANGED, PRESSED } from 'external/dev_april_corgi+/js/emu/events';
import { MenuEntries } from 'external/dev_april_corgi+/js/emu/menu/menu_controller';
import { MenuClassNames } from 'external/dev_april_corgi+/js/emu/menu/menu_element';
import { MenuHandle, MenuService } from 'external/dev_april_corgi+/js/emu/menu/menu_service';

import { PointCategory, WayCategory } from 'java/org/trailcatalog/models/categories';
import { S2LatLng } from 'java/org/trailcatalog/s2';
import { projectS2LatLng, unprojectS2LatLng } from 'js/map/camera';
import { MAPTERHORN_COPYRIGHT } from 'js/map/common/copyrights';
import { LatLngZoom, Vec2 } from 'js/map/common/types';
import { MAP_MOVED, UNCLAIMED_CLICKED } from 'js/map/events';
import { Layer } from 'js/map/layer';
import { SkyboxLayer } from 'js/map/layers/skybox_layer';
import { MapController } from 'js/map/map_controller';
import { ANTARCTIC_CAP, ARCTIC_CAP } from 'js/map/layers/mbtile_layer';
import { PolarCapLayer } from 'js/map/layers/polar_cap_layer';
import { Elevations } from 'js/map/workers/elevations';
import { LocationIndex } from 'js/map/workers/location_index';
import { Z_BOTTOM } from 'js/map/z';
import { getUnitSystem, setUnitSystem, UnitSystem } from 'js/units/formatters';
import {
  Collection,
  CreateCollectionResponse,
  DeleteCollectionResponse,
  GetAviationWeatherResponse,
  GetCollectionResponse,
  GetCurrentUserResponse,
  GetOsmTagsResponse,
  ListCollectionsResponse,
  Role,
  SaveResponse,
  SetViewStateResponse,
  OsmElementType,
} from 'trails_lat/proto/data_pb';

import { CollectionLayer, HeldObject } from './collection_layer';
import { CollectionSettingsDialog, SettingsPanel } from './collection_settings_dialog';
import { requestData } from './data';
import {
  ConfirmDeleteCollectionDialog,
  ConfirmDeleteDialog,
  ImportFailedDialog,
  SaveFailedDialog,
} from './dialogs';
import { DrawingLayer, toE7Array } from './drawing_layer';
import { LineRefiner } from './line_refiner';
import {
  FEATURE_CLICKED,
  FEATURE_CONTEXT_MENU,
  FEATURE_EDITED,
  FEATURE_HOVERED,
  FIELD_EDITED,
  FIELD_ICON_CLICKED,
  LayerObject,
  LINE_DRAWN,
  LineSpot,
  MARKER_DRAWN,
  POINT_PLACED,
  POLYGON_DRAWN,
  Tool,
  TOOL_REQUESTED,
} from './events';
import { toGeoJson, toGpx } from './exporter';
import { FeatureLayer } from './feature_layer';
import {
  CollectionStatus,
  FeatureListState,
  InspectedObject,
  topLevelFolderIds,
} from './feature_list';
import { Change, FeatureStore } from './feature_store';
import {
  EditableFeature,
  EditableLine,
  EditablePolygon,
  EditableShape,
  FeatureData,
  folderFromProto,
  importableIcon,
  isShape,
  lineFromProto,
  pointFromProto,
  polygonFromProto,
  schemaToWrite,
  snapshot,
  toWrite,
} from './features';
import { parseImport } from './importer';
import {
  applyLayerSettings,
  diffLayerSettings,
  findLayerNode,
  layerDefaultsOf,
  LayerEntry,
  layerEntries,
  LayerNode,
  LayerSetting,
  LayerSettings,
  LayerTreeState,
  updateLayerNode,
} from './layer_tree';
import { LayerCatalog } from './layer_catalog';
import { LineProfiler, MeasureProfiler } from './profiles';
import {
  insertVertex,
  joinLines,
  minVertexCount,
  removeVertex,
  reverseLine,
  splitLine,
} from './line_edits';
import { LoginPopup } from './login_popup';
import { IconPickerDialog } from './icon_picker';
import { GradeLimitState, MeasureState } from './measure_panel';
import { Choice, choiceItem, PICK_MENU_CLASSES, readingItem } from './pick_menu';
import { Point, PointCollectionLayer } from './point_collection_layer';
import { PointToolLayer } from './point_tool_layer';
import {
  adoptImported,
  getFieldKind,
  parseCollectionSchema,
  titleField,
  withDefaults,
} from './schema';
import { haversineMeters, pathLengthMeters, profileSamples } from './measurements';
import { MarkerToolLayer } from './marker_tool_layer';
import { MENU_CLASSES } from './menubar';
import { editMenu, fileMenu, HELP_MENU, USER_MENU, viewMenu } from './menus';
import { LineProfileState } from './profile_chart';
import { SaveEntry, SaveQueue } from './save_queue';
import { SearchHit, SearchQuery, SearchState } from './search_box';
import {
  DEFAULT_COLOR,
  getLineKind,
  pointLook,
} from './workers/collection_schema';

// The zoom where the contours and the trails around a point come in at full detail
const POINT_ZOOM = 14;
// Flattens the points and line and polygon vertices of some features into lat,lng pairs in
// degrees.
function featureLatLngDegrees(features: Iterable<EditableFeature>): number[] {
  const latLngDegrees = [];
  for (const feature of features) {
    if (feature.kind === 'point') {
      latLngDegrees.push(feature.latE7 / 1e7, feature.lngE7 / 1e7);
    } else if (isShape(feature)) {
      for (let i = 0; i < feature.latLngE7.length; i += 2) {
        latLngDegrees.push(feature.latLngE7[i] / 1e7, feature.latLngE7[i + 1] / 1e7);
      }
    }
  }
  return latLngDegrees;
}

// Something a click landed on
type Pick =
    {kind: 'feature'; feature: EditableFeature}
    |{kind: 'object'; entry: LayerEntry; layer: CollectionLayer; object: HeldObject}
    |{kind: 'point'; entry: LayerEntry; layer: PointCollectionLayer; point: Point};

export interface Args {
  // The id of the open collection or none
  collection: string|undefined;
  // Whether to move the camera onto the collection once it loads, which a camera in the URL
  // overrides
  fitCollection: boolean;
}

export interface State {
  collection: Collection|undefined;
  collectionStatus: CollectionStatus;
  features: FeatureListState;
  // The map layer object open in the dialog, when no feature is selected
  inspected: InspectedObject|undefined;
  // How far the line, polygon, or measurement under construction reaches, shown beside the
  // pointer. In pixels from the viewer's top left.
  drawnLength: {x: number; y: number; meters: number}|undefined;
  // Set while the next line clicked joins the one Join with started from
  joining: boolean;
  layers: LayerTreeState;
  // The profile of the selected feature or the inspected object, when that is a line
  lineProfile: LineProfileState|undefined;
  measure: MeasureState;
  // What the terrain tool routes within
  grades: GradeLimitState;
  search: SearchState;
  self: Future<GetCurrentUserResponse>;
  tool: Tool;
}

type Deps = typeof ViewerController.deps;

export class ViewerController extends Controller<Args, Deps, HTMLElement, State> {

  static deps() {
    return {
      controllers: {
        map: MapController,
      },
      services: {
        dialog: DialogService,
        history: HistoryService,
        menu: MenuService,
      },
    };
  }

  private readonly mapController: MapController;
  private readonly dialog: DialogService;
  private readonly history: HistoryService;
  private readonly menu: MenuService;
  private readonly featureLayer: FeatureLayer;
  private readonly lineLayer: DrawingLayer;
  private readonly polygonLayer: DrawingLayer;
  private readonly measureLayer: DrawingLayer;
  private readonly terrainLayer: DrawingLayer;
  private readonly pointLayer: PointToolLayer;
  private readonly markerLayer: MarkerToolLayer;
  private readonly polarCapLayer: PolarCapLayer;
  private readonly skyboxLayer: SkyboxLayer;
  private readonly catalog: LayerCatalog;
  private readonly store: FeatureStore;
  private readonly elevations: Elevations;
  private readonly measureProfiler: MeasureProfiler;
  private readonly lineProfiler: LineProfiler;
  private selected: string|undefined;
  // Kept for centering on, which needs the geometry the dialog's state leaves out
  private inspected: LayerObject|undefined;
  // Moves with every click, so that a slow query for an earlier one is dropped
  private pickGeneration: number;
  // The pick menu and the camera when it opened. The map reports a move whenever it settles, even
  // when the camera stayed put, and only a real move takes the menu away from its click.
  private picked: {camera: LatLngZoom; menu: MenuHandle}|undefined;
  // Moves with every object opened or closed, so that tags arriving for an earlier one are dropped
  private inspectGeneration: number;
  private readonly searchQuery: SearchQuery;
  // Moves with every collection opened or created, so that a slow load of an earlier one is dropped
  private collectionGeneration: number;
  // The collection from the last args we were bound with. Every render rebinds with its element's
  // current props, and those still name the old route after currentCollection has created and
  // routed to a new collection, so only a change in the args counts as navigating.
  private argsCollection: string|undefined;
  // The collection id from the URL that the store holds or is loading, so that a render with the
  // same route doesn't reload it
  private routedCollection: string|undefined;
  // The feature being dragged in the list, and the folder it would drop into, where undefined is
  // the root
  private draggedFeature: string|undefined;
  private dropTarget: {folder: string|undefined}|undefined;
  // The line Join with started from
  private joining: string|undefined;
  // Where the pointer last was, in pixels from the viewer's top left
  private pointer: [number, number]|undefined;
  // Settles once the login popup closes and the user is fetched, so concurrent callers share it
  private login: Promise<void>|undefined;
  private readonly loginPopup: LoginPopup;
  private readonly saves: SaveQueue;
  // What the layer tree starts as, which saved layer settings are relative to
  private readonly layerDefaults: Map<string, LayerSetting>;
  // Moves with every layer toggle or control change, so that a collection's saved layers don't
  // undo one made while it loaded
  private layerEdits: number;
  // Serialized so that an older view state cannot land after a newer one
  private viewStateWrites: Promise<void>;
  // The menubar item whose menu is open or loading. A File menu still waiting on ListCollections
  // when another menu takes over sees it change and stays closed.
  private menuTrigger: Element|undefined;
  // The open menu, whether the menubar's, a context menu, or a click's pick menu
  private openedMenu: MenuHandle|undefined;
  // A failure the dialog is already up for stays quiet, or else every retry that fails for the
  // same reason stacks another one on the page.
  private warnedUnsaved: boolean;
  lastChange: number;

  constructor(response: Response<ViewerController>) {
    super(response);
    this.mapController = response.deps.controllers.map;
    this.dialog = response.deps.services.dialog;
    this.history = response.deps.services.history;
    this.menu = response.deps.services.menu;
    this.saves = new SaveQueue(entries => this.save(entries), e => {
      console.error(e);
      this.warnUnsaved();
    });
    this.store = new FeatureStore(this.saves);
    this.viewStateWrites = Promise.resolve();
    this.elevations = new Elevations();
    this.measureProfiler =
        new MeasureProfiler(
            this.elevations,
            () => toDegrees(this.measuringLayer().placedPoints()),
            () => this.state.measure,
            measure => {
              this.updateState({...this.state, measure});
            });
    this.lineProfiler =
        new LineProfiler(
            this.elevations,
            () => this.state.lineProfile,
            lineProfile => {
              this.updateState({...this.state, lineProfile});
            });
    this.selected = undefined;
    this.inspected = undefined;
    this.pickGeneration = 0;
    this.picked = undefined;
    this.inspectGeneration = 0;
    this.searchQuery =
        new SearchQuery(
            () => {
              const center = this.mapController.camera.center;
              const corner = this.mapController.viewportBounds.lo();
              const radiusMeters =
                  haversineMeters(
                      center.latDegrees(),
                      center.lngDegrees(),
                      corner.latDegrees(),
                      corner.lngDegrees());
              return {center, radiusMeters};
            },
            () => this.state.search,
            search => {
              this.updateState({...this.state, search});
            });
    this.collectionGeneration = 0;
    this.argsCollection = response.args.collection;
    this.routedCollection = response.args.collection;
    this.draggedFeature = undefined;
    this.dropTarget = undefined;
    this.joining = undefined;
    this.pointer = undefined;
    this.store.listen(() => {
      this.refreshFeatureList();
    });
    this.warnedUnsaved = false;
    this.menuTrigger = undefined;
    this.openedMenu = undefined;
    this.lastChange = Date.now();

    this.loginPopup = new LoginPopup(response => {
      response.then(r => {
        this.signedIn(r);
      }, e => {
        console.error(e);
      });
    });
    this.registerDisposable(this.loginPopup);

    // One index for every layer, so that the drawing tools snap onto and route across drawn
    // lines and paths alike.
    const locations = new LocationIndex();
    // One cache, so that measuring a line just drawn doesn't fetch its lines again
    const refiner = new LineRefiner();
    const camera = this.mapController.camera;
    const renderer = this.mapController.renderer;
    // Line profiles and new vertices sample their elevations from Mapterhorn
    this.featureLayer =
        new FeatureLayer(
            [MAPTERHORN_COPYRIGHT], this.store, locations, refiner, camera, renderer);
    this.registerDisposable(this.featureLayer);
    this.featureLayer.setHidden(this.state.features.hidden);
    this.lineLayer =
        new DrawingLayer(
            'line',
            locations,
            refiner,
            camera,
            renderer,
            () => {
              this.drawnLengthChanged();
            });
    this.registerDisposable(this.lineLayer);
    this.polygonLayer =
        new DrawingLayer(
            'polygon',
            locations,
            refiner,
            camera,
            renderer,
            () => {
              this.drawnLengthChanged();
            });
    this.registerDisposable(this.polygonLayer);
    this.measureLayer =
        new DrawingLayer(
            'measure',
            locations,
            refiner,
            camera,
            renderer,
            () => {
              this.measureChanged();
              this.drawnLengthChanged();
            },
            [MAPTERHORN_COPYRIGHT]);
    this.registerDisposable(this.measureLayer);
    // A line mode, because finishing a route is how to keep it
    this.terrainLayer =
        new DrawingLayer(
            'line',
            locations,
            refiner,
            camera,
            renderer,
            () => {
              this.measureChanged();
              this.drawnLengthChanged();
            },
            [MAPTERHORN_COPYRIGHT],
            (from, to) => {
              const {climbPercent, descentPercent} = this.state.grades;
              return this.elevations.route(
                  from, to, {climb: climbPercent / 100, descent: descentPercent / 100});
            });
    this.registerDisposable(this.terrainLayer);
    this.pointLayer = new PointToolLayer();
    this.registerDisposable(this.pointLayer);
    this.markerLayer = new MarkerToolLayer(camera, renderer);
    this.registerDisposable(this.markerLayer);

    this.registerListener(window, 'keydown', e => {
      this.keyPressed(e);
    });
    // On the root, which hears a move before the map's own listener on document does, so the
    // drawing's change sees where the pointer is now.
    this.registerListener(this.root, 'pointermove', e => {
      const bounds = this.root.getBoundingClientRect();
      this.pointer = [e.clientX - bounds.left, e.clientY - bounds.top];
    });

    this.polarCapLayer =
        new PolarCapLayer(ARCTIC_CAP, ANTARCTIC_CAP, this.mapController.renderer);
    this.registerDisposable(this.polarCapLayer);
    this.skyboxLayer = new SkyboxLayer(Z_BOTTOM, this.mapController.renderer);
    this.registerDisposable(this.skyboxLayer);

    this.catalog = new LayerCatalog(locations, camera, renderer, () => this.state.layers.nodes);
    this.registerDisposable(this.catalog);
    const nodes = this.catalog.nodes;
    this.layerDefaults = layerDefaultsOf(nodes);
    this.layerEdits = 0;
    this.updateState({
      ...this.state,
      layers: {nodes, expanded: new Set(['osm', 'satellite', 'topography', 'us'])},
    });
    this.catalog.start();
    this.setMapLayers(nodes);

    const collection = response.args.collection;
    // The server render already answered with the outline's failure, and a reload is the retry.
    if (collection && this.state.collectionStatus !== 'failed') {
      this.loadCollection(collection, response.args.fitCollection);
    }
  }

  // Opens whatever collection the URL names, including after the back and forward buttons.
  updateArgs(newArgs: Args): void {
    if (newArgs.collection === this.argsCollection) {
      return;
    }

    this.argsCollection = newArgs.collection;
    if (newArgs.collection === this.routedCollection) {
      return;
    }

    const id = newArgs.collection;
    this.routedCollection = id;
    this.collectionGeneration += 1;
    this.saves.clear();
    this.select(undefined);
    this.setHidden([]);
    // Empties the list while the collection loads, or else the last one's rows are left to click.
    this.store.reset([], id ? this.store.isReadOnly() : false);
    this.updateState({
      ...this.state,
      collection: this.state.collection?.id === id ? this.state.collection : undefined,
      collectionStatus: 'loaded',
      features: {...this.state.features, expanded: new Set()},
    });
    if (id) {
      this.loadCollection(id, newArgs.fitCollection);
    }
  }

  // Selects the new line, like onPointPlaced, so that the panel is open to name it.
  onLineDrawn(e: CorgiEvent<typeof LINE_DRAWN>): void {
    this.addLine(e.detail.latLngE7);
  }

  // Selects the new polygon, like onPointPlaced, so that the panel is open to name it.
  onPolygonDrawn(e: CorgiEvent<typeof POLYGON_DRAWN>): void {
    const polygon: EditablePolygon = {
      kind: 'polygon',
      id: crypto.randomUUID(),
      version: 0n,
      data: {},
      latLngE7: e.detail.latLngE7,
    };
    this.addFeature(polygon);
  }

  // Selects the new stroke, like onPointPlaced, so that the panel is open to name it.
  onMarkerDrawn(e: CorgiEvent<typeof MARKER_DRAWN>): void {
    const line: EditableLine = {
      kind: 'line',
      id: crypto.randomUUID(),
      version: 0n,
      data: {marker_zoom: e.detail.zoom},
      latLngE7: e.detail.latLngE7,
      elevationCentimeters: undefined,
      timeSeconds: undefined,
    };
    this.addFeature(line);
  }

  // Selects the new point so that the panel is open to name it, and stays in the tool so that
  // several can go down in a row.
  onPointPlaced(e: CorgiEvent<typeof POINT_PLACED>): void {
    const parent = this.newFeatureParent();
    const point: EditableFeature = {
      kind: 'point',
      id: crypto.randomUUID(),
      version: 0n,
      data: parent !== undefined ? {folder_id: parent} : {},
      latE7: e.detail.latE7,
      lngE7: e.detail.lngE7,
      elevationCentimeters: undefined,
    };
    if (parent !== undefined) {
      this.expand([parent]);
    }
    this.addFeature(point);
  }

  onToolRequested(e: CorgiEvent<typeof TOOL_REQUESTED>): void {
    this.setTool(e.detail.tool);
  }

  onFeatureClicked(e: CorgiEvent<typeof FEATURE_CLICKED>): void {
    this.clickFeature(e.detail.id);
  }

  // Selects or opens the one thing a click landed on, or else offers what it landed on beside what
  // the shown layers read there. A click on nothing clears the selection.
  onUnclaimedClicked(e: CorgiEvent<typeof UNCLAIMED_CLICKED>): void {
    if (this.state.tool !== 'pointer') {
      return;
    }

    const {point, px} = e.detail;
    this.pickGeneration += 1;
    const generation = this.pickGeneration;
    const joining = this.joining;
    const shown =
        layerEntries(this.state.layers.nodes).filter(({shown}) => shown).map(({entry}) => entry);
    const readings: Array<{name: string; value: string}> = [];
    for (const {readout} of joining === undefined ? shown : []) {
      const value = readout?.read(point);
      if (readout && value !== undefined) {
        readings.push({name: readout.name, value});
      }
    }
    const features: Pick[] =
        this.featureLayer.featuresAt(projectS2LatLng(point))
            // Join with waits on another line, so nothing else is worth offering.
            .filter(f => joining === undefined || (f.kind === 'line' && f.id !== joining))
            .map(feature => ({kind: 'feature', feature}));
    const others = joining === undefined ? shown.map(entry => this.picksIn(entry, point)) : [];
    Promise.all(others).then(found => {
      if (generation !== this.pickGeneration) {
        return;
      }

      const picks = [...features, ...found.flat()];
      if (picks.length === 0) {
        this.featureLayer.edit(undefined);
        this.clickFeature(undefined);
      } else if (picks.length === 1 && readings.length === 0) {
        this.openPick(picks[0]);
      }
      // Opening one thing beside a menu of readings reads as two answers to one click, so the
      // person chooses whenever the menu has more than one row.
      const choices = picks.length + readings.length > 1 ? picks : [];
      if (readings.length === 0 && choices.length === 0) {
        return;
      }

      const items: MenuEntries = choices.map(pick =>
          choiceItem(
              this.choiceOf(pick),
              () => {
                this.openPick(pick);
              },
              active => {
                this.highlightPick(pick, active);
              }));
      if (choices.length > 0 && readings.length > 0) {
        items.push({kind: 'divider'});
      }
      items.push(...readings.map(readingItem));
      this.picked = {
        camera: this.mapController.cameraLlz,
        menu: this.openContextMenu(items, px, PICK_MENU_CLASSES),
      };
    });
  }

  private picksIn(entry: LayerEntry, point: S2LatLng): Promise<Pick[]> {
    const layer = entry.layer;
    if (layer instanceof CollectionLayer) {
      return layer.objectsAt(point).then(objects =>
          objects.map(object => ({kind: 'object', entry, layer, object})));
    } else if (layer instanceof PointCollectionLayer) {
      return Promise.resolve(
          layer.pointsAt(point).map(value => ({kind: 'point', entry, layer, point: value})));
    } else {
      return Promise.resolve([]);
    }
  }

  private openPick(pick: Pick): void {
    if (pick.kind === 'feature') {
      this.chooseFeature(pick.feature);
      return;
    }

    this.featureLayer.edit(undefined);
    this.stopJoining();
    if (pick.kind === 'object') {
      this.openObject(pick.layer, pick.object);
    } else if (pick.kind === 'point') {
      this.openObject(pick.layer, {kind: 'point', value: pick.point});
    } else {
      checkExhaustive(pick);
    }
  }

  private chooseFeature(feature: EditableFeature): void {
    this.featureLayer.edit(feature);
    this.clickFeature(feature.id);
  }

  private highlightPick(pick: Pick, on: boolean): void {
    if (pick.kind === 'feature') {
      const id = on ? pick.feature.id : undefined;
      this.featureLayer.setHovered(id);
      this.setHovered(id);
    } else if (pick.kind === 'object') {
      pick.layer.highlightObject(on ? pick.object : undefined, this.mapController);
    } else if (pick.kind === 'point') {
      pick.layer.highlightPoint(on ? pick.point : undefined, this.mapController);
    } else {
      checkExhaustive(pick);
    }
  }

  private choiceOf(pick: Pick): Choice {
    if (pick.kind === 'feature') {
      return {kind: 'feature', feature: pick.feature, schema: this.store.schema()};
    }

    const data = pick.kind === 'object' ? pick.object.value.data : pick.point.data;
    const layerSchema = pick.kind === 'object' ? pick.layer.getSchema(pick.object) : undefined;
    const schema = pick.entry.schema ?? layerSchema;
    // An OSM title is an element id, and the element's name is beside it in the data. An element
    // without one is still told apart from its neighbors by its category.
    const categories =
        schema?.title.kind === 'osm_way'
            ? WayCategory
            : schema?.title.kind === 'osm_point' ? PointCategory : undefined;
    const title =
        schema?.title.kind === 'text'
            ? data[schema.title.key]
            : data.name ?? (categories && categoryName(categories, data.type));
    return {
      kind: 'object',
      shape: pick.kind === 'object' ? pick.object.kind : 'point',
      title: title !== undefined ? String(title) : undefined,
      source: pick.entry.name,
    };
  }

  // Joins the line clicked while Join with is waiting on one. Anything else cancels the join and
  // selects as usual.
  private clickFeature(id: string|undefined): void {
    const from = this.joining;
    this.stopJoining();
    const a = from !== undefined ? this.store.get(from) : undefined;
    const b = id !== undefined ? this.store.get(id) : undefined;
    if (a?.kind === 'line' && b?.kind === 'line' && a.id !== b.id) {
      this.store.apply([
        {id: a.id, before: snapshot(a), after: joinLines(a, b)},
        {id: b.id, before: snapshot(b), after: undefined},
      ]);
      this.select(a.id);
      return;
    }

    this.reveal(id);
  }

  // Opens the folders above what the map selected and scrolls to it, so that the list shows it.
  private reveal(id: string|undefined): void {
    this.expand(this.ancestorsOf(id));
    this.select(id);
    if (id !== undefined) {
      // After the render that puts the row in the list
      requestAnimationFrame(() => {
        this.root.querySelector(`div[data-id="${id}"]`)?.scrollIntoView({block: 'nearest'});
      });
    }
  }

  private openObject(layer: Layer, object: LayerObject): void {
    this.select(undefined);
    this.inspected = object;
    const data = object.value.data;
    const entry =
        layerEntries(this.state.layers.nodes).find(({entry}) => entry.layer === layer)?.entry;
    const layerSchema = layer instanceof CollectionLayer ? layer.getSchema(object) : undefined;
    const schema = checkExists(entry?.schema ?? layerSchema);
    const titleValue = data[schema.title.key];
    const element =
        typeof titleValue !== 'number' ? undefined
            : schema.title.kind === 'osm_point' ? osmElementOf(titleValue)
            : schema.title.kind === 'osm_way' ? {type: 'way' as const, id: titleValue}
            : undefined;
    const osm = element ? {...element, tags: 'loading' as const} : undefined;
    const station = entry?.weatherStation ? data[entry.weatherStation.id] : undefined;
    const reports = entry?.weatherStation ? String(data[entry.weatherStation.reports] ?? '') : '';
    const weather =
        typeof station === 'string'
            ? {
              station,
              metar: reports.includes('METAR'),
              taf: reports.includes('TAF'),
              report: 'loading' as const,
            }
            : undefined;
    const common = {data, schema, osm, weather};
    if (object.kind === 'line') {
      const path = toDegrees(object.value.points);
      this.updateState({
        ...this.state,
        inspected: {
          ...common,
          kind: 'line',
          lengthMeters: pathLengthMeters(path),
          climb: undefined,
        },
      });
      this.loadClimb(path);
    } else if (object.kind === 'point') {
      const ll = unprojectS2LatLng(object.value.position[0], object.value.position[1]);
      this.updateState({
        ...this.state,
        inspected: {
          ...common,
          kind: 'point',
          latDegrees: ll.latDegrees(),
          lngDegrees: ll.lngDegrees(),
        },
      });
    } else {
      this.updateState({...this.state, inspected: {...common, kind: 'polygon'}});
    }
    if (osm) {
      this.loadOsmTags(osm.type, osm.id);
    }
    if (weather) {
      this.loadAviationWeather(weather.station, weather.metar, weather.taf);
    }
  }

  onFeatureEdited(e: CorgiEvent<typeof FEATURE_EDITED>): void {
    const {before, after, vertex} = e.detail;
    const changes = [{id: after.id, before, after}];
    if (vertex === undefined) {
      this.store.apply(changes);
    } else {
      this.applyPlacingVertices(changes, [{id: after.id, index: vertex}]);
    }
  }

  onFeatureContextMenu(e: CorgiEvent<typeof FEATURE_CONTEXT_MENU>): void {
    const {id, spot, px} = e.detail;
    this.stopJoining();
    this.reveal(id);
    const feature = id !== undefined ? this.store.get(id) : undefined;
    const editable = feature !== undefined && !this.store.isReadOnly();
    const items: MenuEntries = [];
    if (editable && feature.kind === 'line' && spot) {
      const count = feature.latLngE7.length / 2;
      items.push({
        kind: 'menu_item',
        label: 'Split here',
        disabled: spot.kind === 'vertex' && (spot.index === 0 || spot.index === count - 1),
        action: () => {
          this.splitLineAt(feature.id, spot);
        },
      });
      items.push({
        kind: 'menu_item',
        label: 'Reverse direction',
        action: () => {
          this.editShape(feature.id, reverseLine);
        },
      });
      items.push({
        kind: 'menu_item',
        label: 'Join with…',
        disabled: this.store.lines().length < 2,
        action: () => {
          this.joining = feature.id;
          this.updateState({...this.state, joining: true});
        },
      });
    }
    if (editable && isShape(feature) && spot?.kind === 'vertex' && spot.handle) {
      items.push({
        kind: 'menu_item',
        label: 'Delete vertex',
        disabled: feature.latLngE7.length / 2 <= minVertexCount(feature),
        action: () => {
          this.editShape(feature.id, shape => removeVertex(shape, spot.index));
        },
      });
    }
    if (editable) {
      items.push({
        kind: 'menu_item',
        label: 'Duplicate',
        action: () => {
          this.duplicateFeature(feature.id);
        },
      });
    }
    const [latE7, lngE7] = coordinatesOf(feature, spot, e.detail.latE7, e.detail.lngE7);
    items.push({
      kind: 'menu_item',
      label: 'Copy coordinates',
      action: () => {
        const text = `${(latE7 / 1e7).toFixed(6)}, ${(lngE7 / 1e7).toFixed(6)}`;
        navigator.clipboard.writeText(text).catch(e => {
          console.error(e);
        });
      },
    });
    if (editable) {
      items.push({kind: 'divider'});
      items.push({
        kind: 'menu_item',
        label: 'Delete',
        action: () => {
          const live = this.store.get(feature.id);
          if (live) {
            this.deleteFeatures([live]);
          }
        },
      });
    }

    this.openContextMenu(items, px);
  }

  onFeatureHovered(e: CorgiEvent<typeof FEATURE_HOVERED>): void {
    this.setHovered(e.detail.id);
  }

  featureClicked(e: CorgiEvent<typeof DOM_MOUSE>): void {
    // The chevron and the eye sit inside the row and have their own handlers.
    if (e.detail.target instanceof Element && e.detail.target.closest('[data-role="toggle"]')) {
      return;
    }

    this.select(checkExists(e.actionElement.data('id')).string());
  }

  featureDragStarted(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const id = checkExists(e.actionElement.data('id')).string();
    this.draggedFeature = id;
    const transfer = (e.detail as DragEvent).dataTransfer;
    if (transfer) {
      // Firefox refuses to start a drag that carries no data.
      transfer.setData('text/plain', id);
      transfer.effectAllowed = 'move';
    }
  }

  featureDraggedOver(e: CorgiEvent<typeof DOM_MOUSE>): void {
    this.dragOver(e.detail as DragEvent, this.dropFolderFor(e));
  }

  featureTreeDraggedOver(e: CorgiEvent<typeof DOM_MOUSE>): void {
    this.dragOver(e.detail as DragEvent, undefined);
  }

  // Clears the target once the drag leaves the tree. Moving between rows leaves one row for
  // another inside it, which keeps the target.
  featureTreeDragLeft(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const related = e.detail.relatedTarget;
    if (!(related instanceof Node) || !e.actionElement.element().contains(related)) {
      this.setDropTarget(undefined);
    }
  }

  featureDropped(e: CorgiEvent<typeof DOM_MOUSE>): void {
    this.drop(e.detail as DragEvent, this.dropFolderFor(e));
  }

  featureTreeDropped(e: CorgiEvent<typeof DOM_MOUSE>): void {
    this.drop(e.detail as DragEvent, undefined);
  }

  featureDragEnded(): void {
    this.draggedFeature = undefined;
    this.setDropTarget(undefined);
  }

  folderToggled(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const id = checkExists(e.actionElement.data('id')).string();
    const expanded = new Set(this.state.features.expanded);
    if (!expanded.delete(id)) {
      expanded.add(id);
    }
    this.updateState({...this.state, features: {...this.state.features, expanded}});
  }

  featureRowEntered(e: CorgiEvent<typeof DOM_POINTER>): void {
    const id = checkExists(e.actionElement.data('id')).string();
    this.featureLayer.setHovered(id);
    this.setHovered(id);
  }

  featureRowLeft(): void {
    this.featureLayer.setHovered(undefined);
    this.setHovered(undefined);
  }

  measureClosed(): void {
    this.setTool('pointer');
  }

  measureUndoClicked(): void {
    this.measuringLayer().popVertex();
  }

  maxClimbChanged(e: CorgiEvent<typeof DOM_MOUSE>): void {
    this.setGrade(e, 'climbPercent');
  }

  maxDescentChanged(e: CorgiEvent<typeof DOM_MOUSE>): void {
    this.setGrade(e, 'descentPercent');
  }

  profileHovered(e: CorgiEvent<typeof DOM_POINTER>): void {
    const source = checkExists(e.actionElement.data('source')).string();
    const samples =
        source === 'line' ? this.lineProfiler.samples : this.measureProfiler.samples;
    if (!samples || samples.distanceMeters.length === 0) {
      return;
    }

    // The chart scales its viewBox to its width, so the pointer's share of the plot is its share
    // of the distance.
    const svg = e.actionElement.element();
    const bounds = svg.getBoundingClientRect();
    const width = checkExists(e.actionElement.data('width')).number();
    const left = checkExists(e.actionElement.data('left')).number() * bounds.width / width;
    const right = checkExists(e.actionElement.data('right')).number() * bounds.width / width;
    const fraction =
        Math.min(1, Math.max(0, (e.detail.clientX - bounds.left - left) / (right - left)));
    const distances = samples.distanceMeters;
    const target = fraction * distances[distances.length - 1];
    let index = 0;
    while (index + 1 < distances.length && distances[index + 1] <= target) {
      index += 1;
    }
    const ll =
        S2LatLng.fromDegrees(
            samples.latLngDegrees[2 * index], samples.latLngDegrees[2 * index + 1]);
    const line = this.state.lineProfile;
    if (source !== 'line') {
      this.measuringLayer().setMarker(projectS2LatLng(ll));
      this.updateState({...this.state, measure: {...this.state.measure, hovered: index}});
    } else if (line?.status === 'loaded') {
      this.featureLayer.setMarker(projectS2LatLng(ll));
      this.updateState({...this.state, lineProfile: {...line, hovered: index}});
    }
  }

  profileLeft(): void {
    this.measureLayer.setMarker(undefined);
    this.terrainLayer.setMarker(undefined);
    this.featureLayer.setMarker(undefined);
    const line = this.state.lineProfile;
    this.updateState({
      ...this.state,
      lineProfile: line?.status === 'loaded' ? {...line, hovered: undefined} : line,
      measure: {...this.state.measure, hovered: undefined},
    });
  }

  saveMeasurementClicked(): void {
    const latLngE7 = toE7Array(this.measuringLayer().points());
    if (latLngE7.length < 4) {
      return;
    }

    this.setTool('pointer');
    this.addLine(latLngE7);
  }

  visibilityToggled(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const id = checkExists(e.actionElement.data('id')).string();
    const hidden = new Set(this.state.features.hidden);
    if (!hidden.delete(id)) {
      hidden.add(id);
    }
    this.setHidden(hidden);
    this.saveViewState();
  }

  newFolderClicked(): void {
    const parent = this.newFeatureParent();
    const folder: EditableFeature = {
      kind: 'folder',
      id: crypto.randomUUID(),
      version: 0n,
      data: parent !== undefined ? {folder_id: parent} : {},
    };
    if (parent !== undefined) {
      this.expand([parent]);
    }
    this.store.apply([{id: folder.id, before: undefined, after: folder}]);
    this.select(folder.id);
  }

  nameChanged(e: CorgiEvent<typeof CHANGED>): void {
    const name = e.detail.value;
    this.editSelectedData(data => ({...data, name: name || undefined}), 'name');
  }

  fieldEdited(e: CorgiEvent<typeof FIELD_EDITED>): void {
    this.editField(e.detail.field.id, e.detail.value);
  }

  // A folder centers on everything inside it.
  centerClicked(): void {
    const selected = this.selected !== undefined ? this.store.get(this.selected) : undefined;
    const features =
        !selected
            ? []
            : selected.kind === 'folder' ? this.store.descendants(selected.id) : [selected];
    const latLngDegrees = featureLatLngDegrees(features);
    const inspected = this.inspected;
    if (inspected?.kind === 'polygon') {
      const bound = inspected.value.bound;
      latLngDegrees.push(bound.low[0], bound.low[1], bound.high[0], bound.high[1]);
    } else if (inspected?.kind === 'point') {
      const ll = unprojectS2LatLng(inspected.value.position[0], inspected.value.position[1]);
      latLngDegrees.push(ll.latDegrees(), ll.lngDegrees());
    } else if (inspected?.kind === 'line') {
      const points = inspected.value.points;
      for (let i = 0; i < points.length; i += 2) {
        const ll = unprojectS2LatLng(points[i], points[i + 1]);
        latLngDegrees.push(ll.latDegrees(), ll.lngDegrees());
      }
    }
    this.fitCamera(latLngDegrees);
  }

  // Moves the camera to show every point in a flat lat,lng array, or nowhere when it's empty.
  private fitCamera(latLngDegrees: number[]): void {
    if (latLngDegrees.length === 0) {
      return;
    }

    let low = [Infinity, Infinity] as Vec2;
    let high = [-Infinity, -Infinity] as Vec2;
    for (let i = 0; i < latLngDegrees.length; i += 2) {
      const lat = latLngDegrees[i];
      const lng = latLngDegrees[i + 1];
      low = [Math.min(low[0], lat), Math.min(low[1], lng)] as Vec2;
      high = [Math.max(high[0], lat), Math.max(high[1], lng)] as Vec2;
    }

    if (low[0] === high[0] && low[1] === high[1]) {
      // A lone point has no extent to fit, so we zoom in until its surroundings are readable.
      this.mapController.setCamera({
        lat: low[0],
        lng: low[1],
        zoom: Math.max(this.mapController.camera.zoom, POINT_ZOOM),
      });
    } else {
      // setCamera tells a rect from a center by the brand, so it has to exist at runtime.
      this.mapController.setCamera({low, high, brand: 'LatLngRect'});
    }
  }

  deselectClicked(): void {
    this.select(undefined);
  }

  fieldIconClicked(e: CorgiEvent<typeof FIELD_ICON_CLICKED>): void {
    const id = e.detail.field.id;
    const selected = this.selected !== undefined ? this.store.get(this.selected) : undefined;
    if (!selected) {
      return;
    }

    const counts = new Map<string, number>();
    for (const feature of this.store.all()) {
      const value = feature.data[id];
      const icon = typeof value === 'string' ? importableIcon(value) : undefined;
      if (icon) {
        counts.set(icon, (counts.get(icon) ?? 0) + 1);
      }
    }

    const current = selected.data[id];
    const fill =
        selected.kind === 'point' ? pointLook(this.store.schema(), selected.data)?.fill : undefined;
    this.dialog.display(IconPickerDialog({
      color: fill ?? DEFAULT_COLOR,
      current: typeof current === 'string' ? current : undefined,
      onChosen: icon => {
        this.editField(id, icon);
      },
      used: [...counts].sort((a, b) => b[1] - a[1]).map(([icon]) => icon),
    })).catch(() => {});
  }

  folderChanged(e: CorgiEvent<typeof CHANGED>): void {
    const folder = e.detail.value;
    if (folder) {
      this.expand([folder]);
    }
    this.editSelectedData(data => ({...data, folder_id: folder || undefined}));
  }

  deleteClicked(): void {
    const feature = this.selected !== undefined ? this.store.get(this.selected) : undefined;
    if (!feature) {
      return;
    }

    const doomed =
        feature.kind === 'folder' ? [...this.store.descendants(feature.id), feature] : [feature];
    const confirmed =
        doomed.length > 1
            ? this.dialog.display(ConfirmDeleteDialog({count: doomed.length - 1}))
            : Promise.resolve();
    confirmed.then(() => {
      this.deleteFeatures(doomed);
    }, () => {});
  }

  onMove(e: CorgiEvent<typeof MAP_MOVED>): void {
    const {center, zoom} = e.detail;
    const picked = this.picked?.camera;
    if (
        picked
            && (picked.lat !== center.latDegrees()
                || picked.lng !== center.lngDegrees()
                || picked.zoom !== zoom)) {
      // Another menu may have replaced the pick menu since, and that one stays.
      if (this.openedMenu === this.picked?.menu) {
        this.closeMenu();
      }
      this.picked = undefined;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('lat', center.latDegrees().toFixed(7));
    url.searchParams.set('lng', center.lngDegrees().toFixed(7));
    url.searchParams.set('zoom', zoom.toFixed(3));
    this.history.silentlyReplaceUrl(url.toString());
  }

  // A group's row opens it and a layer's row shows it, since a group has nothing else to click for.
  layerRowClicked(e: CorgiEvent<typeof DOM_MOUSE>): void {
    // The chevron and the eye sit inside the row and have their own handlers.
    if (e.detail.target instanceof Element && e.detail.target.closest('[data-role="toggle"]')) {
      return;
    }

    const node = this.layerNodeOf(e);
    if (node.kind === 'group') {
      this.toggleLayerExpanded(node.id);
    } else {
      this.setLayerEnabled(node.id, !node.enabled);
    }
  }

  layerExpandToggled(e: CorgiEvent<typeof DOM_MOUSE>): void {
    this.toggleLayerExpanded(this.layerNodeOf(e).id);
  }

  layerVisibilityToggled(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const node = this.layerNodeOf(e);
    this.setLayerEnabled(node.id, !node.enabled);
  }

  layerControlChanged(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const entry = this.layerNodeOf(e);
    if (entry.kind !== 'layer') {
      throw new Error(`Group ${entry.id} has no controls`);
    }

    const key = checkExists(e.actionElement.data('key')).string();
    const control = checkExists(entry.controls.find(c => c.key === key));
    const input = e.actionElement.element() as HTMLInputElement;
    let value;
    if (control.kind === 'checkbox') {
      value = input.checked;
    } else if (control.kind === 'date') {
      value = input.value;
    } else if (control.kind === 'percent') {
      value = input.valueAsNumber;
      if (!(value >= 0 && value <= 100)) {
        return;
      }
    } else if (control.kind === 'select') {
      value = (e.actionElement.element() as HTMLSelectElement).value;
    } else {
      throw checkExhaustive(control);
    }

    const values = {...entry.values, [key]: value};
    this.updateState({
      ...this.state,
      layers: {
        ...this.state.layers,
        nodes: updateLayerNode(this.state.layers.nodes, entry.id, () => ({...entry, values})),
      },
    });
    entry.configure?.(values);
    // The Sentinel layers credit the years they search
    this.mapController.copyrightsChanged();
    this.layerEdits += 1;
    this.saveViewState();
  }

  menubarMenuClicked(e: CorgiEvent<typeof DOM_MOUSE>): void {
    this.menubarMenu(
        checkExists(e.actionElement.data('menu')).string(), e.actionElement.element());
  }

  menubarMenuEntered(e: CorgiEvent<typeof DOM_POINTER>): void {
    const trigger = e.actionElement.element();
    // Only a menubar menu has a trigger, and a context or pick menu stays put.
    if (
        !this.openedMenu?.isOpen
            || this.menuTrigger === undefined
            || this.menuTrigger === trigger) {
      return;
    }

    this.menubarMenu(checkExists(e.actionElement.data('menu')).string(), trigger);
  }

  toolClicked(e: CorgiEvent<typeof ACTION>): void {
    this.setTool(checkExists(e.actionElement.data('tool')).string() as Tool);
  }

  loginClicked(): void {
    this.requireLogin().catch(e => {
      console.error(e);
    });
  }

  private menubarMenu(menu: string, trigger: Element): void {
    if (!this.claimMenu(trigger)) {
      return;
    }

    if (menu === 'file') {
      const listing: Future<ListCollectionsResponse> =
          requestData('lat.trails.DataService/ListCollections', {});
      listing.then(response => {
        const items =
            fileMenu(response, this.state.collection !== undefined, this.store.isReadOnly(), {
              newCollection: () => {
                this.newCollection();
              },
              openCollection: collection => {
                this.openCollection(collection);
              },
              openSettings: () => {
                this.openSettings('overview');
              },
              importFiles: () => {
                this.importFiles();
              },
              exportGpx: () => {
                this.download(
                    toGpx([...this.store.all()], this.store.schema()),
                    'gpx',
                    'application/gpx+xml');
              },
              exportGeoJson: () => {
                this.download(
                    toGeoJson([...this.store.all()], this.store.schema()),
                    'geojson',
                    'application/geo+json');
              },
            });
        this.openMenu(items, trigger);
      });
    } else if (menu === 'edit') {
      this.openMenu(editMenu(this.store), trigger);
    } else if (menu === 'view') {
      const choose = (system: UnitSystem) => {
        this.setUnitSystem(system);
      };
      this.openMenu(viewMenu(getUnitSystem(), choose), trigger);
    } else if (menu === 'help') {
      this.openMenu(HELP_MENU, trigger);
    } else if (menu === 'user') {
      this.openMenu(USER_MENU, trigger);
    }
  }

  // Deactivates before activating, because the drawing layers share the index's routing switch.
  private setTool(tool: Tool): void {
    this.stopJoining();
    this.lineLayer.setActive(false);
    this.polygonLayer.setActive(false);
    this.measureLayer.setActive(false);
    this.terrainLayer.setActive(false);
    this.pointLayer.setActive(tool === 'point');
    this.markerLayer.setActive(tool === 'marker');
    this.featureLayer.setInteractive(tool === 'pointer');
    this.featureLayer.setPointsDraggable(tool === 'point');
    // Refreshes the credits, because the measure layer's only count while it is active
    this.setMapLayers(this.state.layers.nodes);
    if (tool === 'line') {
      this.lineLayer.setActive(true);
    } else if (tool === 'polygon') {
      this.polygonLayer.setActive(true);
    } else if (tool === 'measure') {
      this.measureLayer.setActive(true);
    } else if (tool === 'terrain') {
      this.terrainLayer.setActive(true);
    }
    this.updateState({
      ...this.state,
      tool,
    });
  }

  // Skipped while typing, so that the browser's own undo still works in text fields.
  private keyPressed(e: KeyboardEvent): void {
    // Checked before defaultPrevented, because the line being edited also takes Escape
    if (e.key === 'Escape' && this.joining !== undefined) {
      this.stopJoining();
      e.preventDefault();
      return;
    }

    // A map layer already handled it, like Delete removing a vertex from the line being edited
    if (e.defaultPrevented) {
      return;
    }

    const target = e.target;
    if (
        target instanceof HTMLInputElement
            || target instanceof HTMLTextAreaElement
            || target instanceof HTMLSelectElement
            || (target instanceof HTMLElement && target.isContentEditable)) {
      return;
    }

    // Folders only go through the button, because a stray key taking a folder of dozens of
    // features with it is too easy.
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.state.tool === 'pointer') {
      const feature = this.selected !== undefined ? this.store.get(this.selected) : undefined;
      if (feature && feature.kind !== 'folder') {
        this.deleteFeatures([feature]);
        e.preventDefault();
      }
      return;
    }

    if (!(e.ctrlKey || e.metaKey) || e.altKey) {
      return;
    }

    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      this.store.undo();
    } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
      this.store.redo();
    } else {
      return;
    }
    e.preventDefault();
  }

  // Without elevations, because the profile samples the DEM along a line that has none, and
  // elevations read at the vertices alone would draw each segment as a straight slope.
  private addLine(latLngE7: Int32Array): void {
    const line: EditableLine = {
      kind: 'line',
      id: crypto.randomUUID(),
      version: 0n,
      data: {},
      latLngE7,
      elevationCentimeters: undefined,
      timeSeconds: undefined,
    };
    this.addFeature(line);
  }

  // Starts a feature somebody made with its fields' defaults, and selects it.
  private addFeature(feature: EditableFeature): void {
    feature.data = withDefaults(this.store.schema(), feature);
    this.store.apply([{id: feature.id, before: undefined, after: feature}]);
    this.select(feature.id);
  }

  // Resolves undefined when the tiles could not be fetched.
  private sampleVertices(latLngE7: Int32Array): Promise<Int32Array|undefined> {
    const degrees = Float64Array.from(latLngE7, e7 => e7 / 1e7);
    return this.elevations.sample(degrees, profileSamples(degrees).zoom)
        .then(meters => Int32Array.from(meters, m => Math.round(m * 100)), () => undefined);
  }

  private measureChanged(): void {
    this.measureProfiler.changed(
        this.state.tool === 'terrain' ? this.terrainLayer.routeStatus() : undefined);
  }

  // The measure and terrain tools share the panel and its state, and only one is active at a time.
  private measuringLayer(): DrawingLayer {
    return this.state.tool === 'terrain' ? this.terrainLayer : this.measureLayer;
  }

  // Ignores what isn't a positive number, like an emptied field.
  private setGrade(e: CorgiEvent<typeof DOM_MOUSE>, key: keyof GradeLimitState): void {
    const percent = Number((e.actionElement.element() as HTMLInputElement).value);
    if (!(percent > 0) || percent === this.state.grades[key]) {
      return;
    }

    this.updateState({...this.state, grades: {...this.state.grades, [key]: percent}});
    this.terrainLayer.reroute();
  }

  // Where a new feature goes: inside the selected folder, or else beside the selected feature.
  private newFeatureParent(): string|undefined {
    const selected = this.selected !== undefined ? this.store.get(this.selected) : undefined;
    return selected?.kind === 'folder' ? selected.id : selected && this.store.parentOf(selected);
  }

  private setHovered(id: string|undefined): void {
    if (id === this.state.features.hovered) {
      return;
    }

    this.updateState({
      ...this.state,
      features: {
        ...this.state.features,
        hovered: id,
        hoveredAncestors: new Set(this.ancestorsOf(id)),
      },
    });
  }

  private ancestorsOf(id: string|undefined): string[] {
    const ancestors = [];
    let at = id !== undefined ? this.store.get(id) : undefined;
    while (at) {
      const parent = this.store.parentOf(at);
      if (parent === undefined) {
        break;
      }
      ancestors.push(parent);
      at = this.store.get(parent);
    }
    return ancestors;
  }

  // Closes whatever map layer object is open, because the dialog shows one thing at a time. The
  // profile marker goes too, because its chart leaves without a pointerleave.
  private select(id: string|undefined): void {
    this.selected = id;
    this.featureLayer.setSelected(id);
    this.featureLayer.setMarker(undefined);
    this.inspected = undefined;
    this.inspectGeneration += 1;
    if (this.state.inspected) {
      this.updateState({...this.state, inspected: undefined});
    }
    this.refreshFeatureList();
  }

  private loadClimb(path: Float64Array): void {
    const generation = this.inspectGeneration;
    this.lineProfiler.forObject(
        path,
        () => generation === this.inspectGeneration && this.state.inspected?.kind === 'line',
        (lineProfile, lengthMeters, climb) => {
          const inspected = this.state.inspected;
          if (inspected?.kind === 'line') {
            this.updateState({
              ...this.state,
              inspected: {...inspected, lengthMeters, climb},
              lineProfile,
            });
          }
        });
  }

  // An inspected object's profile belongs to loadClimb, and a marker stroke has none because it
  // marks up the map rather than following the ground.
  private lineProfileFor(live: EditableFeature|undefined): LineProfileState|undefined {
    if (live?.kind === 'line' && getLineKind(live.data) === 'line') {
      return this.lineProfiler.forLine(live);
    } else if (this.state.inspected?.kind === 'line') {
      return this.state.lineProfile;
    }
    this.lineProfiler.forget();
    return undefined;
  }

  private loadOsmTags(type: 'node'|'way', id: number): void {
    const generation = this.inspectGeneration;
    const loading: Future<GetOsmTagsResponse> =
        requestData('lat.trails.DataService/GetOsmTags', {
          type: type === 'node' ? OsmElementType.NODE : OsmElementType.WAY,
          id: BigInt(id),
        });
    loading
        .then(
            response => response.tags,
            e => {
              console.error(e);
              return 'failed' as const;
            })
        .then(tags => {
          const inspected = this.state.inspected;
          if (generation !== this.inspectGeneration || !inspected?.osm) {
            return;
          }

          this.updateState({
            ...this.state,
            inspected: {...inspected, osm: {...inspected.osm, tags}},
          });
        });
  }

  private loadAviationWeather(station: string, metar: boolean, taf: boolean): void {
    const generation = this.inspectGeneration;
    // The cache never expires, so reopening a station would show the report it had the first
    // time. The server caches for a few minutes instead.
    invalidateCache(method => method === 'lat.trails.DataService/GetAviationWeather');
    const loading: Future<GetAviationWeatherResponse> =
        requestData('lat.trails.DataService/GetAviationWeather', {station, metar, taf});
    loading
        .then(
            response => response,
            e => {
              console.error(e);
              return 'failed' as const;
            })
        .then(report => {
          const inspected = this.state.inspected;
          if (generation !== this.inspectGeneration || !inspected?.weather) {
            return;
          }

          this.updateState({
            ...this.state,
            inspected: {...inspected, weather: {...inspected.weather, report}},
          });
        });
  }

  searchChanged(e: CorgiEvent<typeof CHANGED>): void {
    this.updateState({...this.state, search: {...this.state.search, query: e.detail.value}});
    this.searchQuery.trigger();
  }

  searchFocused(): void {
    this.searchQuery.trigger();
  }

  searchBlurred(): void {
    this.searchQuery.close();
  }

  searchKeyPressed(e: CorgiEvent<typeof PRESSED>): void {
    const {results, highlighted} = this.state.search;
    if (!results) {
      return;
    }

    if (e.detail.key === 'Escape') {
      this.searchBlurred();
    } else if (e.detail.key === 'ArrowDown' || e.detail.key === 'ArrowUp') {
      const step = e.detail.key === 'ArrowDown' ? 1 : -1;
      const next = Math.max(0, Math.min(results.length - 1, highlighted + step));
      this.updateState({...this.state, search: {...this.state.search, highlighted: next}});
    }
  }

  searchSubmitted(): void {
    const {results, highlighted} = this.state.search;
    const hit = results?.[highlighted];
    if (hit) {
      this.pickSearchHit(hit);
    }
  }

  searchResultPicked(e: CorgiEvent<typeof DOM_POINTER>): void {
    const index = Number(checkExists(e.actionElement.data('index')).string());
    const hit = this.state.search.results?.[index];
    if (hit) {
      this.pickSearchHit(hit);
    }
  }

  private pickSearchHit(hit: SearchHit): void {
    this.searchQuery.close();
    this.fitCamera([...hit.low, ...hit.high]);
  }

  // Merged per field, so that dragging across the color picker is one undo
  private editField(id: string, value: boolean|number|string|undefined): void {
    this.editSelectedData(data => ({...data, [id]: value}), `field:${id}`);
  }

  private editSelectedData(update: (data: FeatureData) => FeatureData, mergeKey?: string): void {
    const live = this.selected !== undefined ? this.store.get(this.selected) : undefined;
    if (!live) {
      return;
    }

    const before = snapshot(live);
    const after = {...snapshot(live), data: stripUndefined(update({...live.data}))};
    // Merged per feature, so that typing in one name and then another stay two undos
    this.store.apply(
        [{id: live.id, before, after}],
        mergeKey !== undefined ? `${mergeKey}:${live.id}` : undefined);
  }

  // The folder a drop onto this row lands in. A row that is not a folder passes it to the folder
  // it is in, so dropping onto a sibling moves nothing.
  private dropFolderFor(e: CorgiEvent<typeof DOM_MOUSE>): string|undefined {
    const row = this.store.get(checkExists(e.actionElement.data('id')).string());
    if (!row) {
      return undefined;
    }
    return row.kind === 'folder' ? row.id : this.store.parentOf(row);
  }

  // Whether the dragged feature may go into folder. A folder cannot move into itself or anything
  // under it.
  private canDropInto(folder: string|undefined): boolean {
    const dragged = this.draggedFeature;
    if (dragged === undefined) {
      return false;
    }
    return folder === undefined
        || (folder !== dragged && !this.ancestorsOf(folder).includes(dragged));
  }

  // Marks folder as the target when the drop is allowed. The browser only drops where dragover
  // called preventDefault.
  private dragOver(e: DragEvent, folder: string|undefined): void {
    if (!this.canDropInto(folder)) {
      this.setDropTarget(undefined);
      return;
    }

    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    this.setDropTarget({folder});
  }

  private drop(e: DragEvent, folder: string|undefined): void {
    const dragged = this.draggedFeature;
    const live = dragged !== undefined ? this.store.get(dragged) : undefined;
    if (!live || !this.canDropInto(folder)) {
      return;
    }

    e.preventDefault();
    this.draggedFeature = undefined;
    this.dropTarget = undefined;
    if (folder !== undefined) {
      this.expand([folder]);
    }
    if (this.store.parentOf(live) === folder) {
      this.refreshFeatureList();
      return;
    }

    const before = snapshot(live);
    const after = {...snapshot(live), data: stripUndefined({...live.data, folder_id: folder})};
    this.store.apply([{id: live.id, before, after}]);
  }

  private setDropTarget(target: {folder: string|undefined}|undefined): void {
    if (target?.folder === this.dropTarget?.folder && !target === !this.dropTarget) {
      return;
    }

    this.dropTarget = target;
    this.refreshFeatureList();
  }

  // Follows the pointer with the length drawn so far, which includes the segment to it. A polygon's
  // includes the way back to its first vertex, so it reads as the perimeter.
  private drawnLengthChanged(): void {
    const tool = this.state.tool;
    const layer =
        tool === 'line' ? this.lineLayer
            : tool === 'polygon' ? this.polygonLayer
            : tool === 'measure' || tool === 'terrain' ? this.measuringLayer()
            : undefined;
    const pointer = this.pointer;
    const drawnLength =
        layer?.followsPointer() && pointer
            ? {x: pointer[0], y: pointer[1], meters: pathLengthMeters(toDegrees(layer.points()))}
            : undefined;
    const shown = this.state.drawnLength;
    if (
        drawnLength?.x === shown?.x
            && drawnLength?.y === shown?.y
            && drawnLength?.meters === shown?.meters) {
      return;
    }
    this.updateState({...this.state, drawnLength});
  }

  private stopJoining(): void {
    if (this.joining === undefined) {
      return;
    }

    this.joining = undefined;
    this.updateState({...this.state, joining: false});
  }

  // Splits at a vertex, adding one first when the spot is partway along a segment.
  private splitLineAt(id: string, spot: LineSpot): void {
    const live = this.store.get(id);
    if (live?.kind !== 'line') {
      return;
    }

    const line =
        spot.kind === 'segment' ? insertVertex(live, spot.index, spot.latE7, spot.lngE7) : live;
    const halves =
        splitLine(
            line, spot.index, crypto.randomUUID(), titleField(this.store.schema(), line));
    if (!halves) {
      return;
    }

    const [first, second] = halves;
    const changes = [
      {id: live.id, before: snapshot(live), after: first},
      {id: second.id, before: undefined, after: second},
    ];
    if (spot.kind === 'segment') {
      this.applyPlacingVertices(
          changes, [{id: live.id, index: spot.index}, {id: second.id, index: 0}]);
    } else {
      this.store.apply(changes);
    }
  }

  // Applies an edit that moved or added vertices, then gives each one on a line with elevations
  // of its own the DEM's elevation as part of the same edit. Every other line samples the DEM for
  // its profile anyway.
  //
  // An edit landing before the DEM answers keeps the patch from merging, so the patch becomes an
  // undo of its own. The DEM usually answers well before anyone can edit again.
  private applyPlacingVertices(
      changes: Change[], placed: Array<{id: string; index: number}>): void {
    const mergeKey = `placed:${crypto.randomUUID()}`;
    this.store.apply(changes, mergeKey);
    const targets = placed.flatMap(({id, index}) => {
      const line = this.store.get(id);
      return line?.kind === 'line' && line.elevationCentimeters
          ? [{id, index, latLngE7: line.latLngE7}]
          : [];
    });
    if (targets.length === 0) {
      return;
    }

    const latLngE7 = Int32Array.from(
        targets.flatMap(({index, latLngE7}) => [latLngE7[2 * index], latLngE7[2 * index + 1]]));
    this.sampleVertices(latLngE7).then(centimeters => {
      if (!centimeters) {
        return;
      }

      const patches = targets.flatMap(({id, index, latLngE7}, i) => {
        const live = this.store.get(id);
        // Geometry edits replace the array rather than writing through it, so the same array means
        // the line has kept its shape since.
        if (live?.kind !== 'line' || live.latLngE7 !== latLngE7 || !live.elevationCentimeters) {
          return [];
        }

        const elevationCentimeters = live.elevationCentimeters.slice();
        elevationCentimeters[index] = centimeters[i];
        return [{id, before: snapshot(live), after: {...snapshot(live), elevationCentimeters}}];
      });
      this.store.apply(patches, mergeKey);
    });
  }

  private editShape(id: string, edit: (shape: EditableShape) => EditableShape|undefined): void {
    const live = this.store.get(id);
    const after = isShape(live) ? edit(live) : undefined;
    if (live && after) {
      this.store.apply([{id, before: snapshot(live), after}]);
    }
  }

  // Selects the copy, because it lands exactly on the original and would otherwise look like
  // nothing happened.
  private duplicateFeature(id: string): void {
    const live = this.store.get(id);
    if (!live) {
      return;
    }

    const copy = {...snapshot(live), id: crypto.randomUUID(), version: 0n};
    const field = titleField(this.store.schema(), copy);
    const title = field !== undefined ? copy.data[field] : undefined;
    if (field !== undefined && typeof title === 'string' && title) {
      copy.data[field] = `${title} copy`;
    }
    this.store.apply([{id: copy.id, before: undefined, after: copy}]);
    this.select(copy.id);
  }

  // In the order given, which for a folder is its descendants deepest first and then itself, so
  // each folder is empty by the time its delete lands.
  private deleteFeatures(features: EditableFeature[]): void {
    this.store.apply(features.map(f => ({id: f.id, before: snapshot(f), after: undefined})));
    if (features.some(f => f.id === this.selected)) {
      this.select(undefined);
    }
  }

  // Hands the list copies, because the store edits features in place and corgi skips rendering a
  // component whose props are the same objects as last time.
  private refreshFeatureList(): void {
    const live = this.selected !== undefined ? this.store.get(this.selected) : undefined;
    const selected = live && snapshot(live);
    this.updateState({
      ...this.state,
      features: {
        ...this.state.features,
        all: [...this.store.all()].map(snapshot),
        schema: this.store.schema(),
        selected,
        selectedDescendants:
            selected?.kind === 'folder' ? this.store.descendants(selected.id).length : 0,
        hoveredAncestors: new Set(this.ancestorsOf(this.state.features.hovered)),
        dropTarget: this.dropTarget,
      },
      lineProfile: this.lineProfileFor(live),
    });
  }

  private newCollection(): void {
    this.history.goTo('/');
  }

  // Shows the name from the listing while the rest loads.
  private openCollection(collection: Collection): void {
    if (collection.id === this.routedCollection) {
      return;
    }

    this.updateState({...this.state, collection});
    this.history.goTo(`/collection/${collection.id}`);
  }

  // One undo for every schema edit made while the dialog is open
  private openSettings(panel: SettingsPanel): void {
    const collection = this.state.collection;
    if (!collection) {
      return;
    }

    const mergeKey = `settings:${crypto.randomUUID()}`;
    this.dialog.display(CollectionSettingsDialog({
      collection,
      editable: !this.store.isReadOnly(),
      panel,
      schema: this.store.schema(),
      onDelete: () => this.deleteCollection(collection),
      onSchemaChanged: schema => {
        this.store.setSchema(schema, mergeKey);
      },
      onUpdated: updated => {
        if (this.state.collection?.id === updated.id) {
          this.updateState({...this.state, collection: updated});
        }
      },
    })).catch(() => {});
  }

  private deleteCollection(collection: Collection): Promise<boolean> {
    const count = [...this.store.all()].length;
    return this.dialog.display(ConfirmDeleteCollectionDialog({count, name: collection.name}))
        .then(() => {
          const deleted: Future<DeleteCollectionResponse> =
              requestData('lat.trails.DataService/DeleteCollection', {id: collection.id});
          return deleted;
        }, () => undefined)
        .then(response => {
          // Replaced rather than pushed so that back doesn't land on the deleted collection.
          if (response && this.state.collection?.id === collection.id) {
            this.history.replaceTo('/');
          }
          return !!response;
        })
        .catch(e => {
          console.error(e);
          return false;
        });
  }

  private loadCollection(id: string, fit: boolean): void {
    this.collectionGeneration += 1;
    const generation = this.collectionGeneration;
    const hidden = this.state.features.hidden;
    const layerEdits = this.layerEdits;
    this.updateState({...this.state, collectionStatus: 'loading'});
    const loading: Future<GetCollectionResponse> =
        requestData('lat.trails.DataService/GetCollection', {id});
    loading
        .then(response => {
          if (generation !== this.collectionGeneration) {
            return;
          }
          this.updateState({
            ...this.state,
            collection: response.collection,
            collectionStatus: 'loaded',
          });
          const readOnly = response.collection?.role === Role.READ;
          // A toggle made since the request, like on the rows the server rendered, is newer than
          // what the response read.
          if (this.state.features.hidden === hidden) {
            this.setHidden(response.hiddenFeatureIds);
          }
          if (this.layerEdits === layerEdits) {
            this.setLayerSettings(
                response.layers ? JSON.parse(response.layers) as LayerSettings : {});
          }
          const features = [
            ...response.folders.map(folderFromProto),
            ...response.lines.map(lineFromProto),
            ...response.points.map(pointFromProto),
            ...response.polygons.map(polygonFromProto),
          ];
          const schema = parseCollectionSchema(response.schema);
          this.expand(topLevelFolderIds(features, schema, this.state.features.hidden));
          this.store.reset(features, readOnly, {schema, version: response.schemaVersion});
          if (fit) {
            this.fitCamera(featureLatLngDegrees(this.store.all()));
          }
          const tool = this.state.tool;
          const drawing =
              tool === 'point' || tool === 'line' || tool === 'polygon' || tool === 'marker';
          if (readOnly && drawing) {
            this.setTool('pointer');
          }
        })
        .catch(e => {
          console.error(e);
          if (generation === this.collectionGeneration) {
            this.updateState({...this.state, collectionStatus: 'failed'});
          }
        });
  }

  private importFiles(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.geojson,.gpx,.json,application/geo+json,application/gpx+xml';
    input.multiple = true;
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      Promise.all(files.map(file => this.importOne(file)))
          .then(results => {
            // One edit for the whole pick, so that a single undo takes back everything it added.
            this.store.apply(results.flatMap(r => r.changes));
            const failed = results.flatMap(r => r.failed ? [r.failed] : []);
            if (failed.length > 0) {
              this.dialog.display(ImportFailedDialog({files: failed})).catch(() => {});
            }
          });
    });
    input.click();
  }

  private download(text: string, extension: string, type: string): void {
    const url = URL.createObjectURL(new Blob([text], {type}));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.state.collection?.name || 'trails'}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // Wraps the file's features in a folder named after it, so that importing a pile of files does
  // not bury the collection's root. Reports the file's name when it yielded nothing, so that
  // picking several files names every one that failed in a single dialog.
  private importOne(file: File): Promise<{changes: Change[]; failed?: string}> {
    return file.text()
        .then(text => {
          const features = parseImport(text);
          // A GPX carrying only routes parses and still leaves nothing to draw, which looks the
          // same to somebody who picked a file and watched the map not change.
          if (features.length === 0) {
            return {changes: [], failed: file.name};
          }

          const folder: EditableFeature = {
            kind: 'folder',
            id: crypto.randomUUID(),
            version: 0n,
            data: {name: file.name.replace(/\.[^.]*$/, '')},
          };
          const schema = this.store.schema();
          for (const feature of features) {
            feature.data.folder_id ??= folder.id;
            adoptImported(schema, feature);
            feature.data = withDefaults(schema, feature);
          }
          return {
            changes: [folder, ...features].map(f => ({id: f.id, before: undefined, after: f})),
          };
        })
        .catch(e => {
          console.error(e);
          return {changes: [], failed: file.name};
        });
  }

  private save(entries: SaveEntry[]): Promise<bigint> {
    return this.currentCollection()
        .then(collectionId => {
          const saved: Future<SaveResponse> =
              requestData('lat.trails.DataService/Save', {
                collectionId,
                writes:
                    entries.map(e =>
                        e.kind === 'schema'
                            ? schemaToWrite(e.schema)
                            : toWrite(e.op, e.feature)),
              });
          return saved;
        })
        .then(response => response.version);
  }

  // Dismissing the dialog arms it again, so a later failure is not silent.
  private warnUnsaved(): void {
    if (this.warnedUnsaved) {
      return;
    }

    this.warnedUnsaved = true;
    const dismissed = () => {
      this.warnedUnsaved = false;
    };
    this.dialog.display(SaveFailedDialog({})).then(dismissed, dismissed);
  }

  private currentCollection(): Promise<string> {
    const open = this.state.collection;
    if (open) {
      return Promise.resolve(open.id);
    }

    return this.requireLogin()
        .then(() => {
          const created: Future<CreateCollectionResponse> =
              requestData(
                  'lat.trails.DataService/CreateCollection', {
                    name: newCollectionName(),
                    schema: JSON.stringify(this.store.schema()),
                  });
          return created;
        })
        .then(response => {
          const collection = checkExists(response.collection);
          this.updateState({
            ...this.state,
            collection,
          });
          this.routedCollection = collection.id;
          this.history.replaceTo(`/collection/${collection.id}`);
          // Anything hidden or any layer changed before the collection existed had nowhere to save
          // to.
          if (this.state.features.hidden.size > 0 || this.layerEdits > 0) {
            this.saveViewState();
          }
          return collection.id;
        });
  }

  private setHidden(ids: Iterable<string>): void {
    const hidden = new Set(ids);
    this.featureLayer.setHidden(hidden);
    this.updateState({...this.state, features: {...this.state.features, hidden}});
  }

  private expand(ids: Iterable<string>): void {
    const expanded = new Set([...this.state.features.expanded, ...ids]);
    this.updateState({...this.state, features: {...this.state.features, expanded}});
  }

  // Viewers get no view state, so they start from the owner's every time they open the collection.
  private saveViewState(): void {
    const collection = this.state.collection;
    if (!collection || (collection.role !== Role.OWNER && collection.role !== Role.WRITE)) {
      return;
    }

    const request = {
      collectionId: collection.id,
      hiddenFeatureIds: [...this.state.features.hidden],
      layers: JSON.stringify(diffLayerSettings(this.state.layers.nodes, this.layerDefaults)),
    };
    this.viewStateWrites = this.viewStateWrites
        .then(() => {
          const saved: Future<SetViewStateResponse> =
              requestData('lat.trails.DataService/SetViewState', request);
          return saved;
        })
        .then(() => {}, e => {
          console.error(e);
        });
  }

  private requireLogin(): Promise<void> {
    if (this.login) {
      return this.login;
    }

    // Somebody already signed in whose GetCurrentUser has not landed yet gets a popup if we go by
    // finished, so wait the fetch out instead.
    return this.state.self.then(
        response => response.user ? Promise.resolve() : this.openLogin());
  }

  private openLogin(): Promise<void> {
    if (this.login) {
      return this.login;
    }

    // Callers wait on this, so it has to settle even when the user fetch fails, or else the write
    // queue behind it never runs again.
    this.login = this.loginPopup.open()
        .then(response => {
          this.signedIn(response);
          if (!response.user) {
            throw new Error('Nobody signed in');
          }
        })
        .finally(() => {
          this.login = undefined;
        });
    return this.login;
  }

  private signedIn(response: GetCurrentUserResponse): void {
    this.updateState({...this.state, self: resolvedFuture(response)});
    if (!response.user) {
      return;
    }

    // Now that the user is logged in, they may have edit rights to the open collection. So reload
    // if they're currently in a read-only mode.
    const open = this.state.collection;
    if (open && this.store.isReadOnly()) {
      this.loadCollection(open.id, /* fit= */ false);
    } else {
      this.saves.flush();
    }
  }

  // Closes whatever menu is open and makes trigger's the one to open. Answers false when trigger's
  // own menu was the open one, so that clicking it again only closes it.
  private claimMenu(trigger: Element): boolean {
    const toggled = this.openedMenu?.isOpen && this.menuTrigger === trigger;
    this.closeMenu();
    this.menuTrigger = toggled ? undefined : trigger;
    return !toggled;
  }

  private closeMenu(): void {
    this.openedMenu?.close();
    this.openedMenu = undefined;
    this.menuTrigger = undefined;
  }

  // Opens a menu at px, which is relative to the map's canvas.
  private openContextMenu(
      items: MenuEntries, px: Vec2, classes: MenuClassNames = MENU_CLASSES): MenuHandle {
    this.closeMenu();
    const canvas = checkExists(this.root.querySelector('canvas')).getBoundingClientRect();
    const root = this.root.getBoundingClientRect();
    const menu =
        this.menu.open(
            items,
            {x: canvas.left - root.left + px[0], y: canvas.top - root.top + px[1]},
            this.root,
            {anchor: 'top_left', classes});
    this.openedMenu = menu;
    return menu;
  }

  // Skips a trigger that lost its claim or whose menu an earlier load already opened.
  private openMenu(items: MenuEntries, trigger: Element): void {
    if (this.menuTrigger !== trigger || this.openedMenu?.isOpen) {
      return;
    }

    const bound = trigger.getBoundingClientRect();
    this.openedMenu =
        this.menu.open(
            items,
            {x: bound.left, y: bound.bottom},
            this.root,
            {anchor: 'top_left', classes: MENU_CLASSES, trigger});
  }

  // The formatters read the unit system from a global rather than from props, so a rerender with
  // caching on would skip every element whose props are unchanged.
  private setUnitSystem(system: UnitSystem): void {
    setUnitSystem(system);
    const nodes =
        updateLayerNode(
            this.state.layers.nodes,
            'topography/contours',
            node => ({...node as LayerEntry, layer: this.catalog.contours[system]}));
    corgi.vdomCaching.disable();
    this.updateState({...this.state, layers: {...this.state.layers, nodes}}).then(() => {
      corgi.vdomCaching.enable();
    });
    this.setMapLayers(nodes);
  }

  private layerNodeOf(e: CorgiEvent<typeof DOM_MOUSE>): LayerNode {
    const id = checkExists(e.actionElement.data('id')).string();
    return checkExists(findLayerNode(this.state.layers.nodes, id));
  }

  private toggleLayerExpanded(id: string): void {
    const expanded = new Set(this.state.layers.expanded);
    if (!expanded.delete(id)) {
      expanded.add(id);
    }
    this.updateState({...this.state, layers: {...this.state.layers, expanded}});
  }

  private setLayerEnabled(id: string, enabled: boolean): void {
    const nodes = updateLayerNode(this.state.layers.nodes, id, node => ({...node, enabled}));
    this.updateState({
      ...this.state,
      layers: {...this.state.layers, nodes},
    });
    this.setMapLayers(nodes);
    this.layerEdits += 1;
    this.saveViewState();
  }

  private setLayerSettings(settings: LayerSettings): void {
    const before = this.state.layers.nodes;
    const nodes = applyLayerSettings(before, this.layerDefaults, settings);
    for (const {entry} of layerEntries(nodes)) {
      const previous = findLayerNode(before, entry.id) as LayerEntry;
      if (entry.values !== previous.values) {
        entry.configure?.(entry.values);
      }
    }
    this.updateState({...this.state, layers: {...this.state.layers, nodes}});
    this.setMapLayers(nodes);
  }

  private setMapLayers(nodes: LayerNode[]): void {
    const entries = layerEntries(nodes);
    for (const {entry, shown} of entries) {
      if (entry.layer instanceof CollectionLayer) {
        // A hidden layer's geometry would otherwise answer hovers and catch the line tool.
        entry.layer.setIndexed(shown);
      }
    }
    // The map draws by z, so this order only decides who hears events first. Nodes sit on
    // everything they share the map with and claim what lands on an icon.
    const shown = entries.filter(({shown}) => shown).map(({entry}) => entry.layer);
    this.mapController.setLayers(
        [
          this.pointLayer,
          this.markerLayer,
          this.lineLayer,
          this.polygonLayer,
          this.measureLayer,
          this.terrainLayer,
          this.featureLayer as Layer,
        ]
            .concat(shown.filter(layer => layer instanceof PointCollectionLayer))
            .concat(shown.filter(layer => !(layer instanceof PointCollectionLayer)))
            .concat([this.polarCapLayer, this.skyboxLayer]));
  }
}

// The most specific part of a category's name, like Footway for PATH_FOOTWAY
function categoryName(names: Record<number, string>, type: unknown): string|undefined {
  const name = typeof type === 'number' ? names[type] : undefined;
  if (!name) {
    return undefined;
  }
  const parts = name.split('_');
  const words = (parts.length > 1 ? parts.slice(1) : parts).join(' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.substring(1);
}

// Mercator to interleaved lat then lng degrees
function toDegrees(points: Float64Array): Float64Array {
  const degrees = new Float64Array(points.length);
  for (let i = 0; i < points.length; i += 2) {
    const ll = unprojectS2LatLng(points[i], points[i + 1]);
    degrees[i] = ll.latDegrees();
    degrees[i + 1] = ll.lngDegrees();
  }
  return degrees;
}

// The point's own spot, the spot on a line or ring nearest the click, or else the click
function coordinatesOf(
    feature: EditableFeature|undefined,
    spot: LineSpot|undefined,
    latE7: number,
    lngE7: number): [number, number] {
  if (feature?.kind === 'point') {
    return [feature.latE7, feature.lngE7];
  } else if (isShape(feature) && spot?.kind === 'vertex') {
    return [feature.latLngE7[2 * spot.index], feature.latLngE7[2 * spot.index + 1]];
  } else if (spot?.kind === 'segment') {
    return [spot.latE7, spot.lngE7];
  }
  return [latE7, lngE7];
}

function stripUndefined(data: FeatureData): FeatureData {
  const stripped: FeatureData = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      stripped[key] = value;
    }
  }
  return stripped;
}

function newCollectionName(): string {
  return `Untitled collection ${new Date().toLocaleDateString()}`;
}

// A point's id is twice its node's id, or twice its way's id plus one. Keep in sync with
// ExtractPoints.kt#nodePointId.
function osmElementOf(pointId: number): {type: 'node'|'way'; id: number} {
  return pointId % 2 === 0
      ? {type: 'node', id: pointId / 2}
      : {type: 'way', id: (pointId - 1) / 2};
}
