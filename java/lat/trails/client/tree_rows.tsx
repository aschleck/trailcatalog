import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { UnboundEvents } from 'external/dev_april_corgi+/js/corgi/binder';

const EYE_OUTLINE =
    'M1.5 8 C3.5 4.5 5.5 3.5 8 3.5 C10.5 3.5 12.5 4.5 14.5 8 '
        + 'C12.5 11.5 10.5 12.5 8 12.5 C5.5 12.5 3.5 11.5 1.5 8 Z';

export function Chevron({expanded}: {expanded: boolean}) {
  return (
    <svg className="h-3 shrink-0 stroke-current text-gray-500 w-3" fill="none" viewBox="0 0 16 16">
      <path d={expanded ? 'M3 6 L8 11 L13 6' : 'M6 3 L11 8 L6 13'} strokeWidth="2" />
    </svg>
  );
}

export function Eye({visible}: {visible: boolean}) {
  return (
    <svg className="h-4 shrink-0 stroke-current w-4" fill="none" viewBox="0 0 16 16">
      <path d={EYE_OUTLINE} strokeWidth="1.3" />
      {visible
          ? <circle cx="8" cy="8" fill="currentColor" r="2" />
          : <path d="M2.5 13.5 L13.5 2.5" strokeWidth="1.3" />
      }
    </svg>
  );
}

/**
 * Renders a row of the feature list or the layer tree: a chevron if it opens, then children, then
 * an eye.
 */
export function TreeRow({
  children,
  className,
  dimmed,
  draggable,
  events,
  expanded,
  expandToggled,
  id,
  visibilityToggled,
  visible,
}: {
  children?: corgi.VElementOrPrimitive|corgi.VElementOrPrimitive[];
  // The row's background and weight
  className: string;
  // Whether this row or one above it is hidden
  dimmed: boolean;
  draggable?: boolean;
  events: UnboundEvents;
  // Undefined for a row that doesn't open
  expanded: boolean|undefined;
  expandToggled: string;
  id: string;
  key: string;
  visibilityToggled: string;
  visible: boolean;
}) {
  return (
    <div
        className={
          'cursor-pointer flex gap-1.5 h-7 items-center pl-1 pr-2 select-none '
              + className
              + (dimmed ? ' opacity-50' : '')
        }
        data={{id}}
        draggable={draggable}
        unboundEvents={events}
    >
      {expanded !== undefined
          ? <span
                className="cursor-pointer flex h-4 items-center justify-center shrink-0 w-4"
                data={{id}}
                unboundEvents={{click: expandToggled}}
            >
              <Chevron expanded={expanded} />
            </span>
          : <span className="shrink-0 w-4" />
      }
      {children ?? []}
      <span
          ariaLabel={visible ? 'Hide' : 'Show'}
          className="cursor-pointer hover:text-gray-900 shrink-0 text-gray-500"
          data={{id}}
          title={visible ? 'Hide' : 'Show'}
          unboundEvents={{click: visibilityToggled}}
      >
        <Eye visible={visible} />
      </span>
    </div>
  );
}

// An open row's children sit in a container with a guide line down its left edge, under the
// row's chevron, the way a tree in an outliner shows what belongs to what.
export function TreeChildren({children}: {
  children?: corgi.VElementOrPrimitive|corgi.VElementOrPrimitive[];
  key: string;
}) {
  return <div className="border-gray-300 border-l ml-3">{children ?? []}</div>;
}
