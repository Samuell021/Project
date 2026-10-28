import type { MatchResult } from "../lib/commercialDomain";
import { formatFaMoney, formatFaNumber, matchSummary, sortMatches } from "../lib/commercialDomain";
import { Badge } from "../../../shared/components/ui/Badge";
import { Btn, Card } from "./CrmUIKit";

export function MatchPanel({
  matches,
  offerable,
  onIntroduce,
  onFeedback,
  busy,
}: {
  matches: MatchResult[];
  offerable: boolean;
  onIntroduce?: (match: MatchResult) => void;
  onFeedback?: (match: MatchResult) => void;
  busy?: boolean;
}) {
  const sorted = sortMatches(matches);
  return (
    <div className="space-y-3">
      {sorted.map((match) => (
        <Card key={match.property_file_id} className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <strong>{match.title}</strong>
                <Badge label={`${formatFaNumber(match.match_percent)}٪ تطبیق`} variant={match.matched ? "success" : match.match_percent >= 60 ? "warning" : "danger"} />
                {match.already_introduced ? <Badge label="قبلاً معرفی شده" variant="info" /> : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {match.property_title || match.title} · {match.district || "منطقه نامشخص"} · {formatFaNumber(match.area)} متر · {match.deal_type_name || "نوع معامله نامشخص"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                مبلغ: {formatFaMoney(match.sale_price)} · ودیعه: {formatFaMoney(match.deposit)} · اجاره: {formatFaMoney(match.monthly_rent)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {onIntroduce && !match.already_introduced ? (
                <Btn onClick={() => onIntroduce(match)} disabled={!offerable || busy}>{busy ? "در حال ثبت…" : "معرفی"}</Btn>
              ) : null}
              {onFeedback && match.already_introduced ? <Btn color="light" onClick={() => onFeedback(match)}>ثبت بازخورد</Btn> : null}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {match.reasons.map((reason) => (
              <div key={`${match.property_file_id}-${reason.label}`} className={`rounded-xl border px-3 py-2 text-xs ${reason.passed ? "border-emerald-200 bg-emerald-50/60 text-emerald-900 dark:border-emerald-500/35 dark:bg-emerald-500/12 dark:text-emerald-300" : "border-amber-200 bg-amber-50/60 text-amber-900 dark:border-amber-500/35 dark:bg-amber-500/12 dark:text-amber-300"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{reason.label}</span>
                  <span>{reason.passed ? "منطبق" : "ناسازگار"}</span>
                </div>
                {reason.detail ? <p className="mt-1 text-muted-foreground">{reason.detail}</p> : null}
              </div>
            ))}
          </div>
          {!match.matched ? <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/12 dark:text-red-300">{matchSummary(match)}</p> : null}
        </Card>
      ))}
      {!sorted.length ? <Card>فایلی برای تطبیق یافت نشد.</Card> : null}
    </div>
  );
}
