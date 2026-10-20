import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { Controller, Response } from 'external/dev_april_corgi+/js/corgi/controller';
import { EmptyDeps } from 'external/dev_april_corgi+/js/corgi/deps';
import { CorgiEvent, DOM_MOUSE } from 'external/dev_april_corgi+/js/corgi/events';
import { Checkbox } from 'external/dev_april_corgi+/js/emu/checkbox';
import { ACTION, CHANGED, CLOSE } from 'external/dev_april_corgi+/js/emu/events';
import { Select } from 'external/dev_april_corgi+/js/emu/select';

import {
  LIST,
  PanelCloseButton,
  PrimaryButton,
  SecondaryButton,
  Section,
  SELECT_BOX,
} from './controls';
import { ExportFormat, filterForExport } from './exporter';
import { buildTree, Chevron, FeatureIcon, TreeItem, untitled } from './feature_list';
import { EditableFeature } from './features';
import { getFieldKind, getTitle } from './schema';
import { CollectionSchema } from './workers/collection_schema';

const FORMATS: Array<{format: ExportFormat; label: string}> = [
  {format: 'gpx', label: 'GPX'},
  {format: 'geojson', label: 'GeoJSON'},
];

type OnExport = (format: ExportFormat, features: EditableFeature[]) => void;

interface Props {
  features: EditableFeature[];
  schema: CollectionSchema;
  onExport: OnExport;
}

/** Picks a format and which features to export, then calls onExport with them. */
export function ExportDialog(props: Props) {
  return <ExportPicker {...props} />;
}

interface State {
  format: ExportFormat;
  excluded: string[];
  expanded: string[];
}

function ExportPicker(
    {features, schema, onExport}: Props,
    inState: State|undefined,
    updateState: (newState: State) => void) {
  const tree = buildTree(features, schema);
  const state = inState ?? {
    format: 'gpx',
    excluded: [],
    expanded: tree.filter(i => i.feature.kind === 'folder').map(i => i.feature.id),
  };
  const excluded = new Set(state.excluded);
  const exportable =
      filterForExport(features, excluded).some(f =>
          f.kind === 'line'
              || f.kind === 'point'
              || (f.kind === 'polygon' && state.format === 'geojson'));
  const view = {
    excluded,
    expanded: new Set(state.expanded),
    format: state.format,
    schema,
  };

  return <>
    <div
        js={corgi.bind({
          controller: ExportController,
          args: {features, onExport, tree},
          state: [state, updateState],
        })}
        className="
            bg-white
            flex
            flex-col
            gap-4
            max-w-[calc(100vw-2rem)]
            p-4
            rounded
            text-gray-900
            w-[40rem]
        "
    >
      <div className="flex font-bold items-center justify-between">
        Export
        <PanelCloseButton unboundEvents={{corgi: [[ACTION, 'dismiss']]}} />
      </div>
      <Section label="Features">
        <div className={`${LIST} max-h-[50vh] overflow-y-auto`}>
          {rows(tree, view, /* depth= */ 0)}
        </div>
      </Section>
      <Section label="Format">
        <Select
            ariaLabel="Format"
            className={SELECT_BOX}
            options={FORMATS.map(({format, label}) => ({
              label,
              value: format,
              selected: format === state.format,
            }))}
            unboundEvents={{corgi: [[CHANGED, 'formatChanged']]}}
        />
      </Section>
      <div className="flex gap-2 items-center justify-end">
        <SecondaryButton unboundEvents={{corgi: [[ACTION, 'dismiss']]}}>Cancel</SecondaryButton>
        <PrimaryButton
            className="disabled:opacity-50"
            disabled={!exportable}
            unboundEvents={{corgi: [[ACTION, 'exportClicked']]}}
        >
          Export
        </PrimaryButton>
      </div>
    </div>
  </>;
}

interface View {
  excluded: ReadonlySet<string>;
  expanded: ReadonlySet<string>;
  format: ExportFormat;
  schema: CollectionSchema;
}

function rows(items: TreeItem[], view: View, depth: number): corgi.VElementOrPrimitive[] {
  const rendered = [];
  for (const {feature, children} of items) {
    const folder = feature.kind === 'folder';
    const inside = getItemsInside(children);
    const ids = getToggledIds(feature, inside);
    const unchecked = ids.filter(id => view.excluded.has(id)).length;
    const checked = unchecked === 0;
    // GPX has no polygons
    const faded = checked && feature.kind === 'polygon' && view.format === 'gpx';
    const expanded = folder && view.expanded.has(feature.id);
    rendered.push(
        <div
            className={'flex gap-2 items-center px-2 py-1' + (faded ? ' opacity-50' : '')}
            style={`padding-left: ${0.5 + 1.25 * depth}rem`}
        >
          {folder
              ? <button
                    ariaLabel={expanded ? 'Collapse' : 'Expand'}
                    className="flex h-4 items-center justify-center shrink-0 w-4"
                    data={{id: feature.id}}
                    unboundEvents={{click: 'expandToggled'}}
                >
                  <Chevron expanded={expanded} />
                </button>
              : <span className="shrink-0 w-4" />
          }
          <Checkbox
              checked={checked}
              className="cursor-pointer gap-2 grow min-w-0 select-none"
              data={{id: feature.id}}
              indeterminate={unchecked > 0 && unchecked < ids.length}
              unboundEvents={{corgi: [[ACTION, 'featureToggled']]}}
          >
            <FeatureIcon feature={feature} schema={view.schema} />
            <span className="truncate">
              {getTitle(view.schema, feature) || untitled(getFieldKind(feature))}
            </span>
          </Checkbox>
          {folder
              ? <span className="shrink-0 text-gray-500 text-xs">
                  {String(inside.length)}
                </span>
              : ''
          }
        </div>
    );
    if (expanded) {
      rendered.push(...rows(children, view, depth + 1));
    }
  }
  return rendered;
}

function getItemsInside(items: TreeItem[]): string[] {
  const ids = [];
  for (const {feature, children} of items) {
    if (feature.kind === 'folder') {
      ids.push(...getItemsInside(children));
    } else {
      ids.push(feature.id);
    }
  }
  return ids;
}

function getToggledIds(feature: EditableFeature, inside: string[]): string[] {
  return inside.length > 0 ? inside : [feature.id];
}

interface Args {
  features: EditableFeature[];
  onExport: OnExport;
  tree: TreeItem[];
}

class ExportController extends Controller<Args, EmptyDeps, HTMLElement, State> {

  private readonly features: EditableFeature[];
  private readonly onExport: OnExport;
  private readonly items: Map<string, TreeItem>;

  constructor(response: Response<ExportController>) {
    super(response);
    this.features = response.args.features;
    this.onExport = response.args.onExport;
    this.items = new Map();
    const index = (items: TreeItem[]) => {
      for (const item of items) {
        this.items.set(item.feature.id, item);
        index(item.children);
      }
    };
    index(response.args.tree);
  }

  formatChanged(e: CorgiEvent<typeof CHANGED>): void {
    this.updateState({...this.state, format: e.detail.value as ExportFormat});
  }

  expandToggled(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const id = checkExists(e.actionElement.data('id')).string();
    const expanded = new Set(this.state.expanded);
    if (!expanded.delete(id)) {
      expanded.add(id);
    }
    this.updateState({...this.state, expanded: [...expanded]});
  }

  featureToggled(e: CorgiEvent<typeof ACTION>): void {
    const {feature, children} =
        checkExists(this.items.get(checkExists(e.actionElement.data('id')).string()));
    const ids = getToggledIds(feature, getItemsInside(children));
    const excluded = new Set(this.state.excluded);
    const allChecked = ids.every(i => !excluded.has(i));
    for (const i of ids) {
      if (allChecked) {
        excluded.add(i);
      } else {
        excluded.delete(i);
      }
    }
    this.updateState({...this.state, excluded: [...excluded]});
  }

  exportClicked(): void {
    const {format, excluded} = this.state;
    this.onExport(format, filterForExport(this.features, new Set(excluded)));
    this.trigger(CLOSE, {kind: 'resolve'});
  }

  dismiss(): void {
    this.trigger(CLOSE, {kind: 'reject'});
  }
}
