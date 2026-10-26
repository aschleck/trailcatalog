import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { VElementOrPrimitive } from 'external/dev_april_corgi+/js/corgi';
import { Button } from 'external/dev_april_corgi+/js/emu/button';
import { ACTION } from 'external/dev_april_corgi+/js/emu/events';

import { Tool } from '../model/events';
import { AreaIcon, LineIcon, MeasureIcon, TerrainIcon } from './measure_panel';

const TOOLS: Array<{tool: Tool; label: string; edits: boolean}> = [
  {tool: 'pointer', label: 'Inspect', edits: false},
  {tool: 'point', label: 'Add a point', edits: true},
  {tool: 'line', label: 'Draw a line', edits: true},
  {tool: 'polygon', label: 'Draw an area', edits: true},
  {tool: 'marker', label: 'Draw freehand', edits: true},
  {tool: 'measure', label: 'Measure', edits: false},
  {tool: 'terrain', label: 'Route off trail', edits: false},
];

/** Returns the tools in toolbar order, without the ones that edit when the collection can't be. */
export function getTools(readOnly: boolean): Array<{tool: Tool; label: string}> {
  return TOOLS.filter(({edits}) => !readOnly || !edits);
}

/** Returns the tool's icon, drawn in a 20 by 20 viewBox. */
export function getToolIcon(tool: Tool): VElementOrPrimitive {
  // Icons are inlined because Fabric doesn't have a polyline icon as far as I can tell
  if (tool === 'pointer') {
    return <path d="M5 2.5 L5 15.5 L8.5 12 L11 17.5 L13 16.5 L10.5 11 L15 10.5 Z" strokeWidth="1" />;
  } else if (tool === 'point') {
    return <>
      <path
          d="M10 18 C10 18 4 11.5 4 7.5 A6 6 0 0 1 16 7.5 C16 11.5 10 18 10 18 Z"
          fill="none"
          strokeWidth="1.5"
      />
      <circle cx="10" cy="7.5" r="2" />
    </>;
  } else if (tool === 'line') {
    return <LineIcon />;
  } else if (tool === 'polygon') {
    return <AreaIcon />;
  } else if (tool === 'marker') {
    return <path
        d="M3 14 C5 7 8 16 11 10 S15 4 17 7"
        fill="none"
        strokeLinecap="round"
        strokeWidth="2"
    />;
  } else if (tool === 'measure') {
    return <MeasureIcon />;
  } else {
    return <TerrainIcon />;
  }
}

export function Toolbar({readOnly, tool}: {readOnly: boolean; tool: Tool}) {
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
      {getTools(readOnly).map(({tool: t, label}) =>
          <ToolButton active={tool === t} label={label} tool={t} />)}
    </div>
  </>;
}

function ToolButton({active, label, tool}: {active: boolean; label: string; tool: Tool}) {
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
        {getToolIcon(tool)}
      </svg>
    </Button>
  </>;
}
