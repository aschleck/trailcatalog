import { Copyright } from './types';

// The license for GLO-30 dictates this wording, including the liability sentence.
// https://dataspace.copernicus.eu/sites/default/files/media/files/2025-06/copernicus_contributing_mission_data_access_v2_cop_dem_licenses.pdf
export const COPERNICUS_DEM_COPYRIGHT: Copyright = {
  long:
      'Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space '
          + 'GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights '
          + 'reserved. The organisations in charge of the Copernicus programme by law or by '
          + 'delegation do not incur any liability for any use of the Copernicus WorldDEM-30.',
  short: 'Copernicus DEM',
  url: 'https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM',
};

// Most of Mapterhorn's sources are CC BY, which asks us to say that we changed them.
export const MAPTERHORN_COPYRIGHT: Copyright = {
  long: `Terrain from Mapterhorn's open data sources, modified for this map`,
  short: 'Mapterhorn',
  url: 'https://mapterhorn.com/attribution',
};

// Fills Copernicus's gaps over Armenia and Azerbaijan, see notes.md
export const NASADEM_COPYRIGHT: Copyright = {
  long: 'Contains modified NASADEM data 2000',
};

export const OSM_COPYRIGHT: Copyright = {
  long: 'Map data from OpenStreetMap contributors, available under the Open Database License',
  short: 'OpenStreetMap',
  url: 'https://www.openstreetmap.org/copyright',
};

export const PROTOMAPS_COPYRIGHT: Copyright = {
  ...OSM_COPYRIGHT,
  long: 'Basemap from Protomaps, built from OpenStreetMap data',
  provider: {name: 'Protomaps', url: 'https://protomaps.com/'},
};
