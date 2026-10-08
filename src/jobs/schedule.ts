/** UTC scheduling is independent of the container's local timezone. */
export function scheduleKey(now: Date, trigger: string): string | null {
  // Trigger time must be in HH:MM format
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(trigger)) {
    throw new Error("UPSERT_SATELLITES_TRIGGER_TIME must be HH:MM in UTC");
  }
  const [hour, minute] = trigger.split(":").map(Number);
  // If the current UTC time is before the trigger time, return null to indicate no
  // job should be scheduled yet.
  if (now.getUTCHours() * 60 + now.getUTCMinutes() < hour * 60 + minute)
    return null;
  return now.toISOString().slice(0, 10);
}
