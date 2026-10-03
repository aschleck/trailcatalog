import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { FabricIcon } from 'js/dino/fabric';

/**
 * Explains a trail whose ways don't trace one line, shown on hover or focus. The explanation is
 * absolutely positioned by the caller's position classes against its nearest relative ancestor,
 * and its top padding must reach up to the button or else the hover breaks on the way down.
 */
export function TrailIssue({label, position, sourceRelation}: {
  label?: string;
  position: string;
  sourceRelation: bigint|string;
}) {
  return <>
    <span className="group inline-block" data-role="trail-issue">
      <button
          aria-label={label ? undefined : 'Issue with trail data'}
          className={
            'inline-flex gap-2 items-center rounded'
                + (label ? ' bg-tc-error-100 px-2 py-0.5 text-tc-error-900' : ' text-tc-error-500')
          }
      >
        {label ? <span>{label}</span> : ''}
        <FabricIcon name="Info" />
      </button>
      <div
          className={
            `absolute hidden w-80 z-20 group-focus-within:block group-hover:block ${position}`
          }
      >
        <div
            className={
              'bg-white border border-tc-gray-200 font-normal p-4 rounded shadow-lg text-black'
                  + ' text-sm'
            }
        >
          <p>
            This trail's segments could be out of order or some parts may be missing. This may
            cause incorrect distance and elevation calculations.{' '}
            <a
                className="underline"
                href="https://wiki.openstreetmap.org/wiki/Relation:route"
                target="_blank"
            >
              Read about correcting trails.
            </a>
          </p>
          <a
              className={
                'bg-tc-gray-100 border border-tc-gray-200 inline-flex items-center mt-4'
                    + ' no-underline px-2 py-1 rounded'
              }
              href={`https://www.openstreetmap.org/edit?editor=id&relation=${sourceRelation}`}
              target="_blank"
          >
            <img
                alt=""
                className="h-4 mr-2"
                src="/static/images/icons/osm-logo.svg"
            />
            Open in OSM iD editor
          </a>
        </div>
      </div>
    </span>
  </>;
}
