import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { VElementOrPrimitive } from 'external/dev_april_corgi+/js/corgi';
import { Button } from 'external/dev_april_corgi+/js/emu/button';
import { ACTION } from 'external/dev_april_corgi+/js/emu/events';

import { Tool } from './events';
import { MeasureIcon, TerrainIcon } from './measure_panel';

export function Toolbar({readOnly, tool}: {readOnly: boolean; tool: Tool}) {
  // Icons are inlined because Fabric doesn't have a polyline icon as far as I can tell
  return <>
    <div className="
        absolute
        bg-white-opaque-250
        flex
        flex-col
        gap-1
        left-2
        p-1
        rounded
        shadow-lg
        top-2
        z-10
    ">
      <ToolButton active={tool === 'pointer'} label="Inspect" tool="pointer">
        <path d="M4 2 L4 15 L7.5 11.5 L10 17 L12 16 L9.5 10.5 L14 10 Z" strokeWidth="1" />
      </ToolButton>
      {readOnly
          ? ''
          : <ToolButton active={tool === 'point'} label="Add a point" tool="point">
              <path
                  d="M10 18 C10 18 4 11.5 4 7.5 A6 6 0 0 1 16 7.5 C16 11.5 10 18 10 18 Z"
                  fill="none"
                  strokeWidth="1.5"
              />
              <circle cx="10" cy="7.5" r="2" />
            </ToolButton>
      }
      {readOnly
          ? ''
          : <ToolButton active={tool === 'line'} label="Draw a line" tool="line">
              <polyline
                  fill="none"
                  points="3,15 8,6 12,11 17,4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
              />
              <circle cx="3" cy="15" r="1.5" />
              <circle cx="8" cy="6" r="1.5" />
              <circle cx="12" cy="11" r="1.5" />
              <circle cx="17" cy="4" r="1.5" />
            </ToolButton>
      }
      {readOnly
          ? ''
          : <ToolButton active={tool === 'polygon'} label="Draw an area" tool="polygon">
              <polygon
                  fill="none"
                  points="4,5 14,3 17,13 7,16"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
              />
              <circle cx="4" cy="5" r="1.5" />
              <circle cx="14" cy="3" r="1.5" />
              <circle cx="17" cy="13" r="1.5" />
              <circle cx="7" cy="16" r="1.5" />
            </ToolButton>
      }
      {readOnly
          ? ''
          : <ToolButton active={tool === 'marker'} label="Draw freehand" tool="marker">
              <path
                  d="M3 14 C5 7 8 16 11 10 S15 4 17 7"
                  fill="none"
                  strokeLinecap="round"
                  strokeWidth="2"
              />
            </ToolButton>
      }
      <ToolButton active={tool === 'measure'} label="Measure" tool="measure">
        <MeasureIcon />
      </ToolButton>
      <ToolButton active={tool === 'terrain'} label="Route off trail" tool="terrain">
        <TerrainIcon />
      </ToolButton>
    </div>
  </>;
}

function ToolButton({active, children, label, tool}: {
  active: boolean;
  children?: VElementOrPrimitive|VElementOrPrimitive[];
  label: string;
  tool: Tool;
}) {
  return <>
    <Button
        ariaLabel={label}
        className={
          'cursor-pointer p-1 rounded select-none '
              + (active ? 'bg-gray-900 text-white' : 'text-gray-900 hover:bg-black/10')
        }
        data={{tool}}
        title={label}
        unboundEvents={{corgi: [[ACTION, 'toolClicked']]}}
    >
      <svg className="fill-current h-5 stroke-current w-5" viewBox="0 0 20 20">
        {children ?? []}
      </svg>
    </Button>
  </>;
}
