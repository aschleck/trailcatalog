import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { Controller, Response } from 'external/dev_april_corgi+/js/corgi/controller';
import { EmptyDeps } from 'external/dev_april_corgi+/js/corgi/deps';
import { CorgiEvent, DOM_MOUSE } from 'external/dev_april_corgi+/js/corgi/events';

import {
  CommonsAttribution,
  CommonsImage,
  fetchTaggedImages,
  getCommonsPageUrl,
  hasTaggedImages,
  loadCommonsImages,
  loadFirstThumbnail,
} from './wikimedia';

interface CommonsImages {
  // Unset until the top ranked thumbnail that loads has, then that one alone until the rest have
  // downloaded or failed, then the ones that downloaded in the order fetchTaggedImages ranks them
  shown?: Array<{file: string; url: string}>;
  attributions: {[file: string]: CommonsAttribution|'failed'};
  attributionShown: boolean;
  index: number;
}

const LOADING_COMMONS_IMAGES: CommonsImages = {
  attributions: {},
  attributionShown: false,
  index: 0,
};

type Patch = (patch: (images: CommonsImages) => CommonsImages) => void;

function loadTaggedImages(tags: {[key: string]: string}, patch: Patch): void {
  fetchTaggedImages(tags).then(files => {
    const images = loadCommonsImages(files);
    showImages(images, patch);
    for (const image of images) {
      image.attribution.then(attribution => {
        patch(state => ({
          ...state,
          attributions: {...state.attributions, [image.file]: attribution},
        }));
      });
    }
  });
}

// The first image holds its place when the rest arrive because it's the top ranked one that
// loaded, so it stays first among those that load.
function showImages(images: CommonsImage[], patch: Patch): void {
  const loads = images.map(image => image.loadThumbnail().then(url => ({file: image.file, url})));
  // The rest can all settle before this chain reaches the first, and then they already show it.
  loadFirstThumbnail(images).then(first => {
    patch(state =>
        state.shown
            ? state
            : {...state, shown: first ? [{file: first.image.file, url: first.url}] : []});
  });
  Promise.allSettled(loads).then(results => {
    const shown = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    patch(state => ({...state, shown}));
  });
}

// The box holds its aspect ratio from the first render, because the tags say whether to expect
// images, so nothing below it moves when they arrive. It hides once none of the images load.
//
// Callers key it by the element the tags belong to, because it loads only when created.
/** Shows the Commons images that tags name, with dots to pick among them. */
export function CommonsImageCarousel(
    {className, tags, ...props}: {
      key: string;
      tags: {[key: string]: string};
    } & corgi.Properties,
    state: CommonsImages|undefined,
    updateState: (newState: CommonsImages) => void) {
  if (!hasTaggedImages(tags)) {
    return <></>;
  }
  const images = state ?? LOADING_COMMONS_IMAGES;
  const shown = images.shown;
  const current = shown?.[images.index];
  return <>
    <div
        js={corgi.bind({
          controller: CommonsImagesController,
          args: {tags},
          state: [images, updateState],
        })}
        className={`${shown?.length === 0 ? 'hidden' : ''} ${className ?? ''}`}
        {...props}
    >
      <div className="aspect-[4/3] bg-black/5 overflow-hidden relative rounded w-full">
        {current
            ? <>
                <img alt="" className="h-full object-cover w-full" src={current.url} />
                {images.attributionShown
                    ? <ImageCredit
                          attribution={images.attributions[current.file]}
                          file={current.file}
                      />
                    : <></>
                }
                <button
                    ariaLabel="Image attribution"
                    className="
                        absolute
                        bg-black/50
                        bottom-2
                        cursor-pointer
                        flex
                        h-7
                        hover:bg-black/70
                        items-center
                        justify-center
                        right-2
                        rounded-full
                        text-white
                        w-7
                    "
                    title="Image attribution"
                    unboundEvents={{click: 'imageInfoClicked'}}
                >
                  <svg className="h-5 stroke-current w-5" fill="none" viewBox="0 0 16 16">
                    <circle cx="8" cy="8" r="6.5" strokeWidth="1.25" />
                    <path d="M8 7 V11.5 M8 4.5 V5.5" strokeWidth="1.5" />
                  </svg>
                </button>
              </>
            : <div className="animate-pulse bg-black/5 h-full w-full" />
        }
      </div>
      {shown && shown.length > 1
          ? <div className="flex gap-2 justify-center mt-3">
              {shown.map((_, i) =>
                  <button
                      ariaLabel={`Show image ${i + 1}`}
                      className={
                        'border cursor-pointer h-3 rounded-full w-3 '
                            + (i === images.index
                                ? 'bg-black/60 border-black/60'
                                : 'border-black/30 hover:bg-black/10')
                      }
                      data={{index: i}}
                      unboundEvents={{click: 'imageDotClicked'}}
                  />
              )}
            </div>
          : <></>
      }
    </div>
  </>;
}

interface Args {
  tags: {[key: string]: string};
}

class CommonsImagesController extends Controller<Args, EmptyDeps, HTMLElement, CommonsImages> {

  constructor(response: Response<CommonsImagesController>) {
    super(response);
    loadTaggedImages(response.args.tags, patch => {
      this.updateState(patch(this.state));
    });
  }

  imageDotClicked(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const index = checkExists(e.actionElement.data('index')).number();
    this.updateState({...this.state, attributionShown: false, index});
  }

  imageInfoClicked(): void {
    this.updateState({...this.state, attributionShown: !this.state.attributionShown});
  }
}

function ImageCredit({attribution, file}: {
  attribution: CommonsAttribution|'failed'|undefined;
  file: string;
}) {
  const loaded = attribution && attribution !== 'failed' ? attribution : undefined;
  return <>
    <div className="
        absolute
        bg-black/70
        bottom-0
        flex
        flex-col
        gap-0.5
        inset-x-0
        p-3
        pr-12
        text-white
        text-xs
    ">
      {attribution ? <></> : <div>Loading attribution</div>}
      {loaded?.artist ? <div className="line-clamp-2">{loaded.artist}</div> : <></>}
      {loaded?.license
          ? <div>
              {loaded.licenseUrl
                  ? <a className="underline" href={loaded.licenseUrl} target="_blank">
                      {loaded.license}
                    </a>
                  : loaded.license
              }
            </div>
          : <></>
      }
      <a className="underline" href={getCommonsPageUrl(file)} target="_blank">
        Wikimedia Commons
      </a>
    </div>
  </>;
}
