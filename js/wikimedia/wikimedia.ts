import { md5 } from './md5';

// https://www.mediawiki.org/wiki/Common_thumbnail_sizes
//
// Wikimedia only caches thumbnails at these widths, and 500 is the first one past twice the width
// of the properties panel.
const THUMBNAIL_WIDTH = 500;

export interface CommonsAttribution {
  // As plain text, because Commons sends HTML that we don't render
  artist: string|undefined;
  license: string|undefined;
  licenseUrl: string|undefined;
}

/** Returns whether an element's tags name a Commons file directly or through Wikidata. */
export function hasTaggedImages(tags: {[key: string]: string}): boolean {
  return !!getTaggedFile(tags) || !!getWikidataId(tags);
}

/**
 * Fetches the Commons files an element's tags name, with wikimedia_commons first and then each
 * image (P18) statement on its Wikidata item, preferred rank before normal.
 */
export function fetchTaggedImages(tags: {[key: string]: string}): Promise<string[]> {
  const tagged = getTaggedFile(tags);
  const id = getWikidataId(tags);
  // A Wikidata failure still leaves the tagged file to show.
  const linked =
      id
          ? fetchWikidataImages(id).catch(e => {
            console.error(e);
            return [];
          })
          : Promise.resolve([]);
  return linked.then(files => {
    const all = tagged ? [tagged, ...files] : files;
    const titles = all.map(toTitle);
    return all.filter((_, i) => titles.indexOf(titles[i]) === i);
  });
}

export interface CommonsImage {
  file: string;
  attribution: Promise<CommonsAttribution|'failed'>;
  /** Starts downloading the thumbnail and resolves to its URL once decoded. */
  loadThumbnail(): Promise<string>;
}

// Commons answers at most 50 titles per request.
const IMAGE_INFO_TITLES = 50;

/**
 * Prepares files' thumbnails and attributions, sharing one imageinfo request. A thumbnail tries
 * the URL we compute first and falls back to the one Commons sends, which covers files whose
 * names have moved or that we hash wrong.
 */
export function loadCommonsImages(files: string[]): CommonsImage[] {
  const batch = files.slice(0, IMAGE_INFO_TITLES);
  const info = fetchImageInfo(batch);
  return batch.map(file => {
    const fromApi = info.then(byFile => byFile.get(file));
    let thumbnail: Promise<string>|undefined;
    return {
      file,
      attribution: fromApi.then(
          found => found?.attribution ?? 'failed',
          e => {
            console.error(e);
            return 'failed' as const;
          }),
      loadThumbnail: () => {
        thumbnail ??=
            decodeImage(getCommonsThumbnailUrl(file)).catch(() =>
                fromApi.then(found => {
                  if (!found?.thumbnailUrl) {
                    throw new Error(`Commons has no thumbnail for ${file}`);
                  }
                  return decodeImage(found.thumbnailUrl);
                }));
        return thumbnail;
      },
    };
  });
}

/** Returns the first of images whose thumbnail loads, trying each after the one before fails. */
export function loadFirstThumbnail(images: CommonsImage[]):
    Promise<{image: CommonsImage; url: string}|undefined> {
  const [image, ...rest] = images;
  return image
      ? image.loadThumbnail().then(url => ({image, url}), () => loadFirstThumbnail(rest))
      : Promise.resolve(undefined);
}

export function getCommonsPageUrl(file: string): string {
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(toTitle(file))}`;
}

/** Returns the URL of a file's thumbnail without asking Commons where it is. */
export function getCommonsThumbnailUrl(file: string): string {
  const title = toTitle(file);
  const hash = md5(title);
  const encoded = encodeURIComponent(title);
  // Commons adds an extension to a thumbnail when it converts the format.
  const extension = title.substring(title.lastIndexOf('.') + 1).toLowerCase();
  const thumbnail =
      extension === 'svg' ? `${THUMBNAIL_WIDTH}px-${encoded}.png`
          : extension === 'tif' || extension === 'tiff'
              ? `lossy-page1-${THUMBNAIL_WIDTH}px-${encoded}.jpg`
              : `${THUMBNAIL_WIDTH}px-${encoded}`;
  return 'https://upload.wikimedia.org/wikipedia/commons/thumb/'
      + `${hash[0]}/${hash.substring(0, 2)}/${encoded}/${thumbnail}`;
}

interface WbGetClaimsResponse {
  claims?: {
    [property: string]: Array<{
      mainsnak: {datavalue?: {value: unknown}};
      rank: 'deprecated'|'normal'|'preferred';
    }>;
  };
}

interface ImageInfoResponse {
  query?: {
    normalized?: Array<{from: string; to: string}>;
    redirects?: Array<{from: string; to: string}>;
    pages?: Array<{
      title: string;
      imageinfo?: Array<{
        extmetadata?: {[key: string]: {value: string}};
        thumburl?: string;
      }>;
    }>;
  };
}

interface ImageInfo {
  attribution: CommonsAttribution;
  thumbnailUrl: string|undefined;
}

function decodeImage(url: string): Promise<string> {
  const image = new Image();
  image.src = url;
  return image.decode().then(() => url);
}

// Commons answers under its own titles, so we follow each title we sent through its normalization
// and redirect to find its page.
function fetchImageInfo(files: string[]): Promise<Map<string, ImageInfo>> {
  if (files.length === 0) {
    return Promise.resolve(new Map());
  }
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl',
    iiprop: 'extmetadata|url',
    iiurlwidth: String(THUMBNAIL_WIDTH),
    origin: '*',
    prop: 'imageinfo',
    redirects: '1',
    titles: files.map(file => `File:${file}`).join('|'),
  }).toString();
  return fetchJson(url).then((response: ImageInfoResponse) => {
    const query = response.query ?? {};
    const normalized = new Map(query.normalized?.map(({from, to}) => [from, to]));
    const redirects = new Map(query.redirects?.map(({from, to}) => [from, to]));
    const pages = new Map(query.pages?.map(page => [page.title, page]));
    const byFile = new Map<string, ImageInfo>();
    for (const file of files) {
      let title = `File:${file}`;
      title = normalized.get(title) ?? title;
      title = redirects.get(title) ?? title;
      const info = pages.get(title)?.imageinfo?.[0];
      if (!info) {
        continue;
      }
      const metadata = info.extmetadata ?? {};
      byFile.set(file, {
        attribution: {
          artist: getArtistText(metadata['Artist']?.value),
          license: stripHtml(metadata['LicenseShortName']?.value),
          licenseUrl: getWebUrl(metadata['LicenseUrl']?.value),
        },
        thumbnailUrl: info.thumburl,
      });
    }
    return byFile;
  });
}

function fetchJson(url: URL): Promise<any> {
  return fetch(url).then(response => {
    if (!response.ok) {
      throw new Error(`${url} answered ${response.status}`);
    }
    return response.json();
  });
}

function fetchWikidataImages(id: string): Promise<string[]> {
  const url = new URL('https://www.wikidata.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'wbgetclaims',
    entity: id,
    format: 'json',
    origin: '*',
    property: 'P18',
  }).toString();
  return fetchJson(url).then((response: WbGetClaimsResponse) => {
    const claims = (response.claims?.['P18'] ?? []).filter(claim => claim.rank !== 'deprecated');
    const ranked = [
      ...claims.filter(claim => claim.rank === 'preferred'),
      ...claims.filter(claim => claim.rank !== 'preferred'),
    ];
    return ranked
        .map(claim => claim.mainsnak.datavalue?.value)
        .filter((value): value is string => typeof value === 'string');
  });
}

// Uploaders who credit themselves get their signature, which links their talk page as "(talk)".
function getArtistText(html: string|undefined): string|undefined {
  if (!html) {
    return undefined;
  }
  const body = parseHtml(html);
  for (const link of body.querySelectorAll('a[href*="User_talk:"]')) {
    link.remove();
  }
  return getText(body);
}

// Anyone can edit the page Commons reads this from, so a javascript: URL would reach our href.
function getWebUrl(url: string|undefined): string|undefined {
  if (!url) {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

function getTaggedFile(tags: {[key: string]: string}): string|undefined {
  const commons = tags['wikimedia_commons'];
  return commons?.startsWith('File:') ? commons.substring('File:'.length) : undefined;
}

function getWikidataId(tags: {[key: string]: string}): string|undefined {
  const id = tags['wikidata'];
  return id && /^Q[0-9]+$/.test(id) ? id : undefined;
}

// DOMParser builds an inert document, so the HTML's scripts and images never run or load.
function parseHtml(html: string): HTMLElement {
  return new DOMParser().parseFromString(html, 'text/html').body;
}

function getText(element: HTMLElement): string|undefined {
  return element.textContent?.replace(/\s+/g, ' ').trim() || undefined;
}

function stripHtml(html: string|undefined): string|undefined {
  return html ? getText(parseHtml(html)) : undefined;
}

// Wikidata and OSM tags name files with spaces, but Commons stores and hashes them with
// underscores. Commons also capitalizes the first letter, which hand-typed OSM tags sometimes
// don't. JS uppercases a few rare characters differently from MediaWiki, and the thumbnail
// fallback covers those.
function toTitle(file: string): string {
  return file.trim().replaceAll(' ', '_').replace(/^./u, c => c.toUpperCase());
}
