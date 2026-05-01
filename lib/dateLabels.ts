const utcDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

export function currentUtcDateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function formatUtcDateLabel(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return utcDateFormatter.format(date);
}
