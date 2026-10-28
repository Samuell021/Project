import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "../../../shared/components/ui/Badge";
import { JalaliDateTimeInput } from "../../../shared/components/ui/JalaliDateTimeInput";
import { todayJalali, toJalaliISO, JALALI_MONTHS, formatJalaliDateTime } from "../../../shared/lib/jdate";
import { usePermissions } from "../../../shared/lib/permissions";
import { Btn, Card, Field, Shell, inputCls } from "../components/CrmUIKit";
import { post } from "../lib/crmApi";
import { useLoad } from "../lib/useCrmLoad";
import { buildViewingCalendar } from "../lib/commercialDomain";
import type { Row } from "../types";

const WEEKDAYS = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];

export function Viewings({ csrfToken }: { csrfToken: string }) {
  const { can } = usePermissions();
  const today = todayJalali();
  const [view, setView] = useState({ jy: today.jy, jm: today.jm });
  const [selectedDay, setSelectedDay] = useState(toJalaliISO(new Date().toISOString()));
  const [schedule, setSchedule] = useState({ introduction: "", scheduled_at: "", notes: "" });
  const [result, setResult] = useState({ id: "", result: "INTERESTED", notes: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const urls = useMemo(() => ["/crm/api/viewings/?page_size=300", "/crm/api/introductions/?status=OPEN&page_size=200"], []);
  const { data, error, loading, reload } = useLoad(urls, csrfToken);
  const viewings: Row[] = data[urls[0]] || [];
  const introductions: Row[] = data[urls[1]] || [];
  const cells = buildViewingCalendar(view.jy, view.jm);
  const byDay = useMemo(() => {
    const map = new Map<string, Row[]>();
    viewings.forEach((item) => {
      const day = toJalaliISO(item.scheduled_at);
      map.set(day, [...(map.get(day) || []), item]);
    });
    return map;
  }, [viewings]);
  const todayIso = toJalaliISO(new Date().toISOString());
  const weekDays = useMemo(() => {
    const anchor = new Date();
    const start = new Date(anchor);
    start.setDate(anchor.getDate() - ((anchor.getDay() + 1) % 7));
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return toJalaliISO(day.toISOString());
    });
  }, []);
  const todayRows = byDay.get(todayIso) || [];
  const weekRows = weekDays.flatMap((day) => byDay.get(day) || []);
  const selectedRows = selectedDay ? byDay.get(selectedDay) || [] : [];

  function shiftMonth(delta: number) {
    setView((current) => {
      const month = current.jm + delta;
      if (month < 1) return { jy: current.jy - 1, jm: 12 };
      if (month > 12) return { jy: current.jy + 1, jm: 1 };
      return { ...current, jm: month };
    });
  }

  async function act(target: string, body: Row, success: string) {
    setBusy(true);
    try {
      await post(csrfToken, target, body);
      setMessage(success);
      await reload();
    } catch (errorValue) {
      setMessage(errorValue instanceof Error ? errorValue.message : "عملیات ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      title="بازدیدها و تقویم"
      subtitle="هر بازدید یک وظیفهٔ هم‌زمان می‌سازد؛ ثبت نتیجه وظیفهٔ همان بازدید را می‌بندد."
      error={error}
      loading={loading && !Object.keys(data).length}
      onReload={reload}
    >
      {message ? <div role="status" className="mb-4 rounded-xl bg-secondary px-4 py-3 text-sm">{message}</div> : null}
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Btn color="light" onClick={() => shiftMonth(-1)} aria-label="ماه قبل"><ChevronRight size={16} /></Btn>
              <strong>{JALALI_MONTHS[view.jm - 1]} {view.jy}</strong>
              <Btn color="light" onClick={() => shiftMonth(1)} aria-label="ماه بعد"><ChevronLeft size={16} /></Btn>
            </div>
            <Btn color="light" onClick={() => { setView({ jy: today.jy, jm: today.jm }); setSelectedDay(todayIso); }}>امروز</Btn>
          </div>
          <div role="grid" aria-label="تقویم بازدیدها" className="grid grid-cols-7 gap-1 text-center text-xs">
            {WEEKDAYS.map((day) => <div key={day} className="py-1 font-bold text-muted-foreground">{day}</div>)}
            {cells.map((cell) => {
              const rows = cell.isoDate ? byDay.get(cell.isoDate) || [] : [];
              const isToday = cell.isoDate === todayIso;
              const isSelected = cell.isoDate === selectedDay;
              return (
                <button
                  key={cell.key}
                  type="button"
                  role="gridcell"
                  aria-label={cell.isoDate ? `روز ${cell.day}` : "روز خالی"}
                  disabled={!cell.day}
                  onClick={() => cell.isoDate && setSelectedDay(cell.isoDate)}
                  className={`min-h-16 rounded-xl border p-1 text-right align-top ${isSelected ? "border-emerald-600 bg-emerald-50/60 dark:bg-emerald-500/12" : isToday ? "border-emerald-300" : ""} ${cell.day ? "cursor-pointer hover:border-emerald-400" : "opacity-0"}`}
                >
                  <span className="block font-bold">{cell.day ? cell.day.toLocaleString("fa-IR") : ""}</span>
                  {rows.slice(0, 2).map((item) => <span key={item.id} className="mt-1 block truncate rounded bg-secondary px-1 text-[10px]">{item.property_file_title}</span>)}
                  {rows.length > 2 ? <span className="mt-1 block text-[10px] text-muted-foreground">{rows.length.toLocaleString("fa-IR")} بازدید</span> : null}
                </button>
              );
            })}
          </div>
        </Card>
        <div className="space-y-3">
          <Card className="space-y-2">
            <h2 className="font-bold">امروز</h2>
            {todayRows.map((item) => (
              <div key={item.id} className="rounded-xl border p-2 text-sm">
                {formatJalaliDateTime(item.scheduled_at).time} · {item.property_file_title} · {item.contact_name}
              </div>
            ))}
            {!todayRows.length ? <p className="text-xs text-muted-foreground">بازدیدی برای امروز ثبت نشده است.</p> : null}
            <h2 className="pt-2 font-bold">این هفته</h2>
            {weekRows.map((item) => (
              <div key={`week-${item.id}`} className="rounded-xl border p-2 text-sm">
                {formatJalaliDateTime(item.scheduled_at).full} · {item.property_file_title}
              </div>
            ))}
            {!weekRows.length ? <p className="text-xs text-muted-foreground">بازدیدی در این هفته ثبت نشده است.</p> : null}
          </Card>
          <Card className="space-y-2">
            <h2 className="font-bold">بازدیدهای {selectedDay ? formatJalaliDateTime(`${selectedDay}T00:00:00`).date : "انتخاب‌شده"}</h2>
            {selectedRows.map((item) => (
              <div key={`selected-${item.id}`} className="space-y-1 rounded-xl border p-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{formatJalaliDateTime(item.scheduled_at).time} · {item.property_file_title}</span>
                  <Badge label={item.completed_at ? item.result : "در انتظار"} variant={item.completed_at ? "muted" : "warning"} />
                </div>
                <p className="text-xs text-muted-foreground">متقاضی: {item.contact_name} · مسئول: {item.assigned_to_name || "—"}</p>
                {!item.completed_at && can("viewing.manage") ? (
                  <div className="flex flex-wrap gap-2">
                    <Btn color="light" onClick={() => setResult({ id: String(item.id), result: "INTERESTED", notes: "" })}>ثبت نتیجه</Btn>
                  </div>
                ) : null}
              </div>
            ))}
            {!selectedRows.length ? <p className="text-xs text-muted-foreground">بازدیدی برای این روز ثبت نشده است.</p> : null}
          </Card>
        </div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card className="space-y-2">
          <h2 className="font-bold">زمان‌بندی بازدید</h2>
          <Field label="معرفی">
            <select value={schedule.introduction} onChange={(event) => setSchedule({ ...schedule, introduction: event.target.value })} className={inputCls}>
              <option value="">انتخاب معرفی</option>
              {introductions.map((item) => <option key={item.id} value={item.id}>{item.inquiry_code} · {item.property_file_title}</option>)}
            </select>
          </Field>
          <JalaliDateTimeInput name="viewing_schedule" label="زمان بازدید" value={schedule.scheduled_at} onChange={(value) => setSchedule((current) => ({ ...current, scheduled_at: value }))} required />
          <Field label="یادداشت">
            <input value={schedule.notes} onChange={(event) => setSchedule({ ...schedule, notes: event.target.value })} className={inputCls} />
          </Field>
          <Btn
            disabled={!schedule.introduction || !schedule.scheduled_at || busy}
            onClick={() => act("/crm/api/viewings/", { introduction: Number(schedule.introduction), scheduled_at: schedule.scheduled_at, notes: schedule.notes }, "بازدید زمان‌بندی شد و وظیفهٔ آن ساخته شد.")}
          >
            ثبت بازدید
          </Btn>
        </Card>
        <Card className="space-y-2">
          <h2 className="font-bold">ثبت نتیجهٔ بازدید</h2>
          {result.id ? (
            <>
              <p className="text-sm text-muted-foreground">بازدید {result.id}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <select value={result.result} onChange={(event) => setResult({ ...result, result: event.target.value })} className={inputCls}>
                  <option value="INTERESTED">مورد پسند متقاضی</option>
                  <option value="NOT_INTERESTED">مورد پسند نبود</option>
                </select>
                <input value={result.notes} onChange={(event) => setResult({ ...result, notes: event.target.value })} placeholder="یادداشت نتیجه" className={inputCls} />
              </div>
              <Btn
                disabled={busy}
                onClick={() => act(`/crm/api/viewings/${result.id}/complete/`, { result: result.result, notes: result.notes }, "نتیجهٔ بازدید ثبت و وظیفه بسته شد.")}
              >
                ثبت نتیجه و بستن وظیفه
              </Btn>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">برای ثبت نتیجه، یک بازدید را از تقویم انتخاب کنید.</p>
          )}
        </Card>
      </div>
    </Shell>
  );
}
