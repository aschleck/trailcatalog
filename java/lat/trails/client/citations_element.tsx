import * as corgi from 'external/dev_april_corgi+/js/corgi';

export function CitationsElement() {
  return <>
    <div>Citations</div>
    <p>
      <a href="https://www.openstreetmap.org/">OpenStreetMap</a> is open data, licensed under the
      <a href="https://opendatacommons.org/licenses/odbl/">
        Open Data Commons Open Database License
      </a>
      (ODbL) by the <a href="https://osmfoundation.org/">OpenStreetMap Foundation</a> (OSMF).
    </p>
    <p>
      <a href="https://maptiler.com/">MapTiler</a> maps are licensed under the terms of their
      <a href="https://www.maptiler.com/copyright/">copyright</a>.
    </p>
    <p>
      Elevation derived products are produced with a combination of the following datasets.

      <ul>
        <li>
          Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018
          provided under COPERNICUS by the European Union and ESA; all rights reserved
        </li>
        <li>NASADEM 1 arc second provided by NASA Earthdata</li>
      </ul>
    </p>
  </>;
}

