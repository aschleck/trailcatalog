import { Copyright } from './types';

// https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM
export const COPERNICUS_DEM_COPYRIGHT: Copyright = {
  long:
      '© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under '
          + 'COPERNICUS by the European Union and ESA; all rights reserved',
  short: 'Copernicus DEM',
  url: 'https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM',
};

export const MAPTERHORN_COPYRIGHT: Copyright = {
  long: 'Mapterhorn',
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
