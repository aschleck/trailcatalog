import { checkExists } from 'js/common/asserts';
import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';

import { Vec2 } from './common/types';
import { DATA_CHANGED, HOVER_CHANGED, MapController, MAP_MOVED, SELECTION_CHANGED } from './map/events';
import { Path, Trail } from './models/types';
import { ViewsService } from './views/views_service';

export type Deps = () => {
  services: {
    views: typeof ViewsService;
  };
}

export interface State {
  hovering: Path|Trail|undefined;
  nearbyTrails: Trail[]|undefined;
  selectedCardPosition: Vec2;
  selectedTrails: Trail[];
}

export class ViewportController<A, D extends Deps, S extends State>
    extends Controller<A, D, HTMLDivElement, S> {

  protected readonly views: ViewsService;
  protected mapController: MapController|undefined;
  protected lastCamera: {lat: number; lng: number; zoom: number}|undefined;

  constructor(response: Response<ViewportController<A, D, S>>) {
    super(response);
    this.views = response.deps.services.views;
  }

  onDataChange(e: CorgiEvent<typeof DATA_CHANGED>): void {
    const {controller} = e.detail;
    this.mapController = controller;
    this.updateState({
      ...this.state,
      nearbyTrails: controller.listTrailsInViewport()
          .sort((a, b) => b.lengthMeters - a.lengthMeters),
    });
  }

  onHoverChanged(e: CorgiEvent<typeof HOVER_CHANGED>): void {
    const {controller} = e.detail;
    this.mapController = controller;
    this.updateState({
      ...this.state,
      hovering: e.detail.target,
    });
  }

  onMove(e: CorgiEvent<typeof MAP_MOVED>): void {
    const {controller, center, zoom} = e.detail;
    this.mapController = controller;
    this.lastCamera = {
      lat: center.latDegrees(),
      lng: center.lngDegrees(),
      zoom,
    };
    this.updateState({
      ...this.state,
      nearbyTrails: controller.listTrailsInViewport()
          .sort((a, b) => b.lengthMeters - a.lengthMeters),
    });
  }

  onSelectionChanged(e: CorgiEvent<typeof SELECTION_CHANGED>): void {
    const {controller, clickPx, selected} = e.detail;
    this.mapController = controller;

    let trails: Trail[];
    if (selected instanceof Path) {
      trails = controller.listTrailsOnPath(selected);
    } else if (selected instanceof Trail) {
      trails = [selected];
    } else {
      trails = [];
    }

    this.updateState({
      ...this.state,
      selectedCardPosition: clickPx,
      selectedTrails: trails,
    });
  }

  viewTrail(e: MouseEvent): void {
    const raw = (e.currentTarget as HTMLElement|undefined)?.dataset?.trailId;
    if (raw === undefined) {
      console.error('Unable to find trail ID');
      return;
    }

    const id = BigInt(raw);
    this.views.showTrail(id);
  }

  highlightTrail(e: MouseEvent): void {
    this.setTrailHighlighted(e, true);
  }

  unhighlightTrail(e: MouseEvent): void {
    this.setTrailHighlighted(e, false);
  }

  private setTrailHighlighted(e: MouseEvent, selected: boolean): void {
    if (!this.mapController) {
      return;
    }
    const id = (checkExists(e.currentTarget) as HTMLElement).dataset.trailId;
    if (!id) {
      return;
    }
    const trail = this.mapController.getTrail(BigInt(id));
    if (!trail) {
      return;
    }
    this.mapController.setHover(trail, selected);
    this.updateState({
      ...this.state,
      hovering: selected ? trail : undefined,
    });
  }
}

