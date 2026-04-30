// Final Event opens at 5pm Pacific each day. Pure helper used by both the
// client (to render a "coming soon" gate on /event/play) and the server (to
// reject startEventRun calls before the window opens).
//
// 'America/Los_Angeles' auto-handles PST vs PDT, so we don't have to track
// daylight savings ourselves.

export const EVENT_OPEN_HOUR_PT = 17; // 5pm Pacific

// Returns the current local hour (0-23) in America/Los_Angeles. Implemented
// via Intl so it works the same on Node and in the browser.
export function getPacificHour(now: Date = new Date()): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    hour12: false,
  });
  // Intl returns "24" at midnight on some node/icu builds; clamp to 0-23.
  const hour = Number(fmt.format(now));
  return Number.isFinite(hour) ? hour % 24 : 0;
}

// True if the Final Event is currently accepting players (i.e. it's >= 5pm
// Pacific local time today). The window is open-ended for now; rolls over
// at midnight Pacific because `getPacificHour` returns 0 again.
export function isEventOpenNow(now: Date = new Date()): boolean {
  return getPacificHour(now) >= EVENT_OPEN_HOUR_PT;
}
