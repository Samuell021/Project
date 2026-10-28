import { useState } from "react";
import { useLoad } from "../lib/useCrmLoad";
import { patch } from "../lib/crmApi";
import { Shell, Card, Btn, Field, inputCls } from "../components/CrmUIKit";
import type { Row, CrmNavigate } from "../types";

export function CrmSettings({ csrfToken, navigate, embedded = false }: { csrfToken: string; navigate: CrmNavigate; embedded?: boolean }) {
  const { data, error, loading, reload } = useLoad(["/crm/api/workflow-settings/current/"], csrfToken);
  const [msg, setMsg] = useState("");
  const settings: Row = data["/crm/api/workflow-settings/current/"] || {};
  async function save(body: Row) {
    try {
      await patch(csrfToken, "/crm/api/workflow-settings/current/", body);
      setMsg("تنظیمات ذخیره شد.");
      reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "خطا در ذخیره تنظیمات");
    }
  }
  return (
    <Shell title={embedded ? "تنظیمات گردش کار" : "تنظیمات CRM"} subtitle="این تنظیمات فقط برای مدیر کل قابل مشاهده و تغییر است و هم‌زمان از پنل ادمین جنگو نیز قابل مدیریت است." error={error} loading={loading && !Object.keys(data).length} onReload={reload} embedded={embedded}>
      {msg ? <div role="status" className="mb-4 rounded-xl bg-surface-muted px-4 py-3 text-sm">{msg}</div> : null}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <h3 className="mb-3 font-bold">جریان ارجاع و پذیرش</h3>
          <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); save({ assignment_waiting_hours: Number(fd.get("assignment_waiting_hours")), default_assignment_due_days: Number(fd.get("default_assignment_due_days")), withdrawal_decision_note_required: fd.get("withdrawal_decision_note_required") === "on", extension_decision_note_required: fd.get("extension_decision_note_required") === "on" }); }} className="space-y-3">
            <Field label="مهلت پاسخ ارجاع بدون پاسخ (ساعت)"><input name="assignment_waiting_hours" type="number" min={0} required defaultValue={settings.assignment_waiting_hours ?? 48} className={inputCls} /></Field>
            <Field label="مهلت پیش‌فرض انجام ارجاع (روز)"><input name="default_assignment_due_days" type="number" min={1} required defaultValue={settings.default_assignment_due_days ?? 5} className={inputCls} /></Field>
            <label className="flex items-center gap-2 text-sm"><input name="withdrawal_decision_note_required" type="checkbox" defaultChecked={!!settings.withdrawal_decision_note_required} />الزام دلیل تصمیم انصراف</label>
            <label className="flex items-center gap-2 text-sm"><input name="extension_decision_note_required" type="checkbox" defaultChecked={!!settings.extension_decision_note_required} />الزام دلیل تصمیم تمدید</label>
            <Btn type="submit">ذخیره تنظیمات</Btn>
          </form>
          {settings.updated_at ? <p className="mt-3 text-xs text-muted-foreground">آخرین ویرایش: {String(settings.updated_at)} · {settings.updated_by_name || ""}</p> : null}
        </Card>
        <Card>
          <h3 className="mb-3 font-bold">سیاست‌های مالی و انواع معامله</h3>
          <p className="mb-3 text-sm text-muted-foreground">نرخ‌ها و درصدهای کمیسیون فقط وقتی معتبرند که مدیر کل آن‌ها را در قالب نسخه سیاست منتشر کند؛ هیچ عدد نمونه‌ای در سیستم ثبت نشده است.</p>
          <div className="flex flex-wrap gap-2">
            <Btn color="light" onClick={() => navigate("crm-finance")}>سیاست‌های کمیسیون و وجوه</Btn>
            <Btn color="light" onClick={() => navigate("crm-deal-types")}>نسخه‌های انواع معامله</Btn>
          </div>
        </Card>
        <Card>
          <h3 className="mb-3 font-bold">ساختار سازمانی و داده‌های پایه</h3>
          <p className="mb-3 text-sm text-muted-foreground">رنج‌ها، عضویت تاریخ‌دار مدیر و مشاور در رنج و انتقال پرونده بین رنج‌ها از این بخش مدیریت می‌شود. داده‌های پایه نیز از صفحات مدیریت مناطق و ویژگی‌ها و پنل ادمین جنگو قابل تغییر است.</p>
          <div className="flex flex-wrap gap-2">
            <Btn color="light" onClick={() => navigate("settings-ranges")}>رنج‌ها</Btn>
            <Btn color="light" onClick={() => navigate("crm-reports")}>گزارش‌های عملیات</Btn>
          </div>
        </Card>
      </div>
    </Shell>
  );
}
