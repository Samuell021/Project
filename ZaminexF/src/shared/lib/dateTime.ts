type LocalDateTimeParts = { date: string; time: string };

function localDateTimeParts(value: string): LocalDateTimeParts {
  if (!value) return { date: "", time: "09:00" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { date: value, time: "09:00" };

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { date: "", time: "09:00" };
  const pad = (part: number) => String(part).padStart(2, "0");
  return {
    date: `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`,
    time: `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`,
  };
}

function localDateTimeToIso(date: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return "";
  const parsed = new Date(`${date}T${time}:00`);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

export { localDateTimeParts, localDateTimeToIso };
export type { LocalDateTimeParts };
