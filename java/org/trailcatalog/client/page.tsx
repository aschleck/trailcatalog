import * as corgi from 'js/corgi';
import { VElementOrPrimitive } from 'js/corgi';
import { IconCheckbox } from 'js/dino/checkbox';
import { FabricIcon } from 'js/dino/fabric';
import { Radio } from 'js/dino/radio';

import { SearchElement } from './search_element';
import { UnitSelector } from './unit_selector_element';

export function Header({query, extra}: {
  query?: string;
  extra?: VElementOrPrimitive|VElementOrPrimitive[],
}) {
  return <>
    <div className="
        align-middle
        bg-tc-gray-900
        flex
        gap-4
        items-center
        leading-none
        p-4
        text-white
        w-full
        max-md:flex-wrap
    ">
      <div className="md:flex-1">
        <a href="/">
          <img
              alt="Trailcatalog logo"
              src="/static/images/logo.svg"
              className="hidden h-6 sm:block"
          />
          <img
              alt="Trailcatalog logo"
              src="/static/images/logomark.svg"
              className="block h-6 sm:hidden"
          />
        </a>
      </div>
      <SearchElement query={query} />
      {extra ? extra : ''}
      <div className="self-stretch md:flex-1">
        <div className="flex gap-4 h-full items-center justify-end">
          <UnitSelector />
          <a href="https://github.com/aschleck/trailcatalog" target="_blank">
            <img
                alt="Trailcatalog on GitHub"
                src="/static/images/icons/github.png"
                className="h-6"
            />
          </a>
          <a
              href="https://docs.google.com/forms/d/e/1FAIpQLSd4RQWYpziXa5yns-lDk3U-4egwVL2AxFcQ2aW4gOBx5wdehw/viewform"
              target="_blank"
          >
            <FabricIcon className="text-2xl" name="Feedback" title="Share feedback" />
          </a>
        </div>
      </div>
    </div>
  </>;
}
