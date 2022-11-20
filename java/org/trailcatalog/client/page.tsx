import * as corgi from 'js/corgi';

import { SearchElement } from './search_element';

export function Header() {
  return <>
    <div className="
        align-middle
        bg-tc-gray-100
        flex
        gap-4
        items-center
        leading-none
        p-4
        text-white
        w-full
    ">
      <div className="basis-1 grow">
        <img
            alt="Trailcatalog logo"
            src="/static/images/logo.svg"
            className="h-6"
        />
      </div>
      <SearchElement />
      <div className="basis-1 flex grow justify-end">
        <a href="https://github.com/aschleck/trailcatalog" target="_blank">
          <img
              alt="Trailcatalog on GitHub"
              src="/static/images/icons/github.png"
              className="h-6"
          />
        </a>
      </div>
    </div>
  </>;
}