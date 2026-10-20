import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { ACTION } from 'external/dev_april_corgi+/js/emu/events';

import { getUnitSystem } from 'js/units/formatters';

import { PanelButton, SecondaryButton, TEXT_BOX } from './controls';
import { getShownZone, toWallClock } from './time_zones';

// Fine enough to watch the sun move, while the weather picks the forecast step nearest to it
export const STEP_MS = 10 * 60 * 1000;

/** The time that the weather and the sun and moon layers show. */
export interface TimelineState {
  // In ms, or undefined to follow the clock
  at: number|undefined;
  // The clock, which the viewer moves every minute
  now: number;
  // The first and last times the forecast reaches, in ms. The slider spans them, and a typed time
  // can go past them for the sun and moon.
  start: number;
  end: number;
  playing: boolean;
  // The tzdb id that times show in, or undefined for the device's zone
  zone: string|undefined;
}

/** Picks the map's time with a slider along the bottom of the map, or a typed date and time. */
export function Timeline({state}: {state: TimelineState}) {
  const at = state.at ?? state.now;
  const forecast = state.start <= at && at <= state.end;
  return (
    <div className="
        -translate-x-1/2
        absolute
        bg-white
        bottom-8
        flex
        flex-wrap
        gap-x-3
        gap-y-1
        items-center
        left-1/2
        px-2
        py-1.5
        rounded
        shadow-lg
        text-gray-900
        text-sm
        w-[min(44rem,calc(100%-1rem))]
        z-20
    ">
      <PanelButton
          label={state.playing ? 'Pause' : 'Play'}
          unboundEvents={{corgi: [[ACTION, 'timePlayClicked']]}}
      >
        {state.playing
            ? <path d="M7 4.5 V15.5 M13 4.5 V15.5" strokeWidth="3" />
            : <path d="M6 4 L16 10 L6 16 Z" fill="currentColor" strokeLinejoin="round" />
        }
      </PanelButton>
      <label className="flex gap-1.5 items-center shrink-0">
        <input
            ariaLabel="Date and time"
            className={`${TEXT_BOX} tabular-nums`}
            type="datetime-local"
            value={toWallClock(at, state.zone)}
            unboundEvents={{change: 'timeTyped'}}
        />
        <span className="text-gray-500" title={state.zone ?? ''}>
          {getZoneName(at, state.zone)}
        </span>
      </label>
      <input
          ariaLabel="Time"
          className={'grow min-w-32' + (forecast ? '' : ' opacity-50')}
          max={String(state.end)}
          min={String(state.start)}
          step={String(STEP_MS)}
          type="range"
          value={String(Math.min(Math.max(at, state.start), state.end))}
          unboundEvents={{change: 'timeChosen', input: 'timeScrubbed'}}
      />
      {state.at !== undefined
          ? <SecondaryButton unboundEvents={{corgi: [[ACTION, 'timeNowClicked']]}}>
              Now
            </SecondaryButton>
          : ''
      }
    </div>
  );
}

/**
 * Returns a formatter for times in the zone the View menu picked, which it leaves unnamed because
 * the timeline names it. Metric means a 24 hour clock.
 */
export function getClock(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: getUnitSystem() === 'metric' ? 'h23' : 'h12',
    timeZone: getShownZone(),
  });
}

// Like PDT, which can change with the date because of daylight saving
function getZoneName(at: number, zone: string|undefined): string {
  return new Intl.DateTimeFormat(undefined, {timeZone: zone, timeZoneName: 'short'})
      .formatToParts(at)
      .find(part => part.type === 'timeZoneName')?.value ?? '';
}
