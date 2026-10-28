import React, { useEffect, useState } from "react";
import { JalaliDateInput } from "./JalaliDateInput";
import { localDateTimeParts, localDateTimeToIso } from "../../lib/dateTime";

type Props = {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
};

function JalaliDateTimeInput({ name, label, value, onChange, required = false }: Props) {
  const [parts, setParts] = useState(() => localDateTimeParts(value));
  const [currentValue, setCurrentValue] = useState(value);

  useEffect(() => {
    setParts(localDateTimeParts(value));
    setCurrentValue(value);
  }, [value]);

  const updateDate = (date: string) => {
    const next = { ...parts, date };
    setParts(next);
    const nextValue = localDateTimeToIso(next.date, next.time);
    setCurrentValue(nextValue);
    onChange(nextValue);
  };

  const updateTime = (time: string) => {
    const next = { ...parts, time };
    setParts(next);
    const nextValue = localDateTimeToIso(next.date, next.time);
    setCurrentValue(nextValue);
    onChange(nextValue);
  };

  return (
    // `flex-wrap` instead of a rigid two-column grid: the date field carries its own 13rem
    // minimum, so inside a narrower cell (a half-width form track, a detail panel) the rigid pair
    // needed ~20.5rem and spilled over its neighbour. Now the clock drops to a second, tidy row
    // instead of overlapping the fields next to it.
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-[13rem] flex-1">
        <JalaliDateInput
          label={label}
          value={parts.date}
          onChange={updateDate}
          required={required}
        />
      </div>
      <label className="block w-28 shrink-0 space-y-1.5 text-xs font-medium text-foreground">
        <span>ساعت</span>
        <input
          type="time"
          value={parts.time}
          onChange={(event) => updateTime(event.target.value)}
          required={required}
          className="w-full rounded-xl border border-border bg-input-background px-3 py-2.5 text-sm"
        />
      </label>
      <input type="hidden" name={name} value={currentValue} />
    </div>
  );
}

export { JalaliDateTimeInput };
