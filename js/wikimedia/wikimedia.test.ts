/**
 * @jest-environment jsdom
 */

import {
  fetchTaggedImages,
  getCommonsThumbnailUrl,
  hasTaggedImages,
  loadCommonsImages,
  loadFirstThumbnail,
} from './wikimedia';

const realError = console.error;
const realFetch = globalThis.fetch;
const RealImage = globalThis.Image;

afterEach(() => {
  console.error = realError;
  globalThis.fetch = realFetch;
  globalThis.Image = RealImage;
});

test('finds thumbnails where Commons puts them', () => {
  expect(getCommonsThumbnailUrl('Mount Rainier from west.jpg')).toBe(
      'https://upload.wikimedia.org/wikipedia/commons/thumb/e/eb/Mount_Rainier_from_west.jpg/'
          + '500px-Mount_Rainier_from_west.jpg');
  expect(getCommonsThumbnailUrl('Flag of France.svg')).toBe(
      'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Flag_of_France.svg/'
          + '500px-Flag_of_France.svg.png');
  expect(getCommonsThumbnailUrl('Snow covered mountain ridge.tif')).toBe(
      'https://upload.wikimedia.org/wikipedia/commons/thumb/1/13/Snow_covered_mountain_ridge.tif/'
          + 'lossy-page1-500px-Snow_covered_mountain_ridge.tif.jpg');
  expect(getCommonsThumbnailUrl('mount Rainier from west.jpg'))
      .toBe(getCommonsThumbnailUrl('Mount Rainier from west.jpg'));
});

test('looks for images in a Commons file or a Wikidata item', () => {
  expect(hasTaggedImages({wikimedia_commons: 'File:A b.jpg'})).toBe(true);
  expect(hasTaggedImages({wikidata: 'Q194057'})).toBe(true);
  expect(hasTaggedImages({wikimedia_commons: 'Category:Mount Rainier'})).toBe(false);
  expect(hasTaggedImages({wikidata: 'Q1;Q2'})).toBe(false);
  expect(hasTaggedImages({name: 'Mount Rainier'})).toBe(false);
});

test('orders the tagged file first and then Wikidata by rank', async () => {
  respondWith({
    claims: {
      P18: [
        {mainsnak: {datavalue: {value: 'Normal.jpg'}}, rank: 'normal'},
        {mainsnak: {datavalue: {value: 'Old.jpg'}}, rank: 'deprecated'},
        {mainsnak: {datavalue: {value: 'Tagged_one.jpg'}}, rank: 'normal'},
        {mainsnak: {datavalue: {value: 'Preferred.jpg'}}, rank: 'preferred'},
      ],
    },
  });
  expect(await fetchTaggedImages({wikidata: 'Q1', wikimedia_commons: 'File:Tagged one.jpg'}))
      .toEqual(['Tagged one.jpg', 'Preferred.jpg', 'Normal.jpg']);
});

test('keeps the tagged file when Wikidata fails', async () => {
  console.error = () => {};
  globalThis.fetch = (() => Promise.reject(new Error('offline'))) as any;
  expect(await fetchTaggedImages({wikidata: 'Q1', wikimedia_commons: 'File:Tagged.jpg'}))
      .toEqual(['Tagged.jpg']);
});

test('credits each file through the titles Commons normalized and redirected', async () => {
  respondWith({
    query: {
      normalized: [{from: 'File:mount Rainier 5917s.JPG', to: 'File:Mount Rainier 5917s.JPG'}],
      redirects: [{from: 'File:Old name.jpg', to: 'File:New name.jpg'}],
      pages: [
        {
          title: 'File:Mount Rainier 5917s.JPG',
          imageinfo: [{
            extmetadata: {
              Artist: {
                value:
                    '<a href="//commons.wikimedia.org/wiki/User:Wsiegmund">Walter Siegmund</a> '
                        + '<a href="//commons.wikimedia.org/wiki/User_talk:Wsiegmund">(talk)</a>',
              },
              LicenseShortName: {value: 'CC BY-SA 3.0'},
              LicenseUrl: {value: 'https://creativecommons.org/licenses/by-sa/3.0'},
            },
          }],
        },
        {
          title: 'File:New name.jpg',
          imageinfo: [{extmetadata: {LicenseShortName: {value: 'Public domain'}}}],
        },
      ],
    },
  });
  const [rainier, renamed, missing] =
      loadCommonsImages(['mount Rainier 5917s.JPG', 'Old name.jpg', 'Missing.jpg']);
  expect(await rainier.attribution).toEqual({
    artist: 'Walter Siegmund',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
  });
  expect(await renamed.attribution)
      .toEqual({artist: undefined, license: 'Public domain', licenseUrl: undefined});
  expect(await missing.attribution).toBe('failed');
});

test('drops license links that are not web URLs', async () => {
  respondWith({
    query: {
      pages: [
        {
          title: 'File:A.jpg',
          imageinfo: [{extmetadata: {LicenseUrl: {value: 'javascript:alert(1)'}}}],
        },
        {
          title: 'File:B.jpg',
          imageinfo: [{extmetadata: {LicenseUrl: {value: 'http://www.gnu.org/copyleft/fdl.html'}}}],
        },
      ],
    },
  });
  const [script, web] = loadCommonsImages(['A.jpg', 'B.jpg']);
  expect(await script.attribution).toEqual(
      {artist: undefined, license: undefined, licenseUrl: undefined});
  expect(await web.attribution).toEqual(
      {artist: undefined, license: undefined, licenseUrl: 'http://www.gnu.org/copyleft/fdl.html'});
});

test('falls back to the thumbnail Commons sends when ours fails', async () => {
  const sent =
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/New_name.jpg/500px-New_name.jpg';
  respondWith({
    query: {
      redirects: [{from: 'File:Old name.jpg', to: 'File:New name.jpg'}],
      pages: [{title: 'File:New name.jpg', imageinfo: [{thumburl: sent}]}],
    },
  });
  decodeOnly([sent]);
  const [renamed] = loadCommonsImages(['Old name.jpg']);
  expect(await renamed.loadThumbnail()).toBe(sent);
});

test('shows the first file whose thumbnail loads', async () => {
  respondWith({query: {pages: []}});
  decodeOnly([getCommonsThumbnailUrl('Second.jpg')]);
  const result = await loadFirstThumbnail(loadCommonsImages(['First.jpg', 'Second.jpg']));
  expect(result?.image.file).toBe('Second.jpg');
});

// Stubs Image so that only the given URLs decode.
function decodeOnly(urls: string[]): void {
  globalThis.Image = class {
    src = '';

    decode(): Promise<void> {
      return urls.includes(this.src)
          ? Promise.resolve()
          : Promise.reject(new Error(`${this.src} failed`));
    }
  } as any;
}

function respondWith(body: unknown): void {
  globalThis.fetch = (() => Promise.resolve({ok: true, json: () => Promise.resolve(body)})) as any;
}
