import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { VElementOrPrimitive } from 'external/dev_april_corgi+/js/corgi';
import { Button } from 'external/dev_april_corgi+/js/emu/button';
import { ACTION } from 'external/dev_april_corgi+/js/emu/events';

import { Tool } from './events';

export function Toolbar({tool}: {tool: Tool}) {
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
      <ToolButton active={tool === 'line'} label="Draw a line" tool="line">
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
