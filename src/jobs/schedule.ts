/** UTC scheduling is independent of the container's local timezone. */
export function scheduleKey(now: Date, trigger: string): string | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(trigger)) {
    throw new Error('UPSERT_SATELLITES_TRIGGER_TIME must be HH:MM in UTC');
  }
  const [hour, minute] = trigger.split(':').map(Number);
  if (now.getUTCHours() * 60 + now.getUTCMinutes() < hour * 60 + minute) return null;
  return now.toISOString().slice(0, 10);
}
