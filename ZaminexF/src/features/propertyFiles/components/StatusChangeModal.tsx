import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { cx } from "../../../shared/lib/utils";
import { Page, Role, Property, PropertyFile, FollowUp, ConsultantItem, BadgeV } from "../../../shared/lib/types";
import { fmtShort, toPersianType, toPersianDeal, toPersianPropertyStatus, toPersianTaskStatus, toPersianTaskType, toPersianPriority, toPersianChannel, propertyStatusToUI, toPersianFollowupType, toPersianPropertyFileStatus } from "../../../shared/lib/utils";
import { Badge } from "../../../shared/components/ui/Badge";
import { Btn } from "../../../shared/components/ui/Btn";
import { Input } from "../../../shared/components/ui/Input";
import { Card } from "../../../shared/components/ui/Card";
import { SelectField } from "../../../shared/components/ui/SelectField";
import { ProfileAvatar } from "../../../shared/components/ui/ProfileAvatar";
import { KpiCard } from "../../../shared/components/ui/KpiCard";
import { EmptyState } from "../../../shared/components/ui/EmptyState";
import { PageHeader } from "../../../shared/components/ui/PageHeader";
import { ConfirmModal } from "../../../shared/components/ConfirmModal";
import { ActionMenu } from "../../../shared/components/ActionMenu";
import { Pagination } from "../../../shared/components/Pagination";
import { BulkActionBar } from "../../../shared/components/BulkActionBar";
import { PropertyCombobox } from "../../../shared/components/ui/PropertyCombobox";
import { ConsultantCombobox } from "../../../shared/components/ui/ConsultantCombobox";
import { DistrictCombobox } from "../../../shared/components/ui/DistrictCombobox";
import { MultiPropertyCombobox } from "../../../shared/components/ui/MultiPropertyCombobox";
import { MultiConsultantCombobox } from "../../../shared/components/ui/MultiConsultantCombobox";
import { apiFetch, readJson, apiErrorMessage, getCsrfToken } from "../../../shared/lib/apiClient";
import { toast } from "../../../shared/lib/utils";
import { Building2, LayoutDashboard, FileText, CheckSquare, Users, BarChart3, Settings, Bell, Search, LogOut, Plus, ChevronLeft, ChevronDown, ChevronRight, Clock, CheckCircle2, AlertCircle, MoreHorizontal, MapPin, Eye, Edit2, Trash2, Archive, Phone, Mail, Calendar, TrendingUp, Activity, Command, Star, List, LayoutGrid, Download, Shield, User, Lock, Key, RefreshCw, Circle, Zap, Target, Award, Upload, Check, AlertTriangle, Info, XCircle, Loader2, CircleCheck, TriangleAlert, Columns, Send, BellRing, X, ChevronUp, SlidersHorizontal, ArrowUpRight, Layers, MessageSquare, Sparkles, GripVertical, MoreVertical, Building, History, Flame, Image, Filter } from "lucide-react";
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis, ReferenceLine, ScatterChart, Scatter, ZAxis, RadialBarChart, RadialBar } from "recharts";
function StatusChangeModal({ propertyFile, onClose, onApply, canReject = false }: { propertyFile: PropertyFile; onClose: () => void; onApply: (status: string, reason?: string) => void; canReject?: boolean; }) {
  const allowed = propertyFile.status === "DRAFT"
    ? (canReject ? ["ACTIVE", "DRAFT"] : ["DRAFT"])
    : ["ACTIVE", "PAUSED", "SOLD", "ARCHIVED", ...(canReject ? ["DRAFT"] : [])];
  const [next, setNext] = useState(allowed.includes(propertyFile.status) ? propertyFile.status : "ACTIVE");
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <Card className="w-full max-w-sm p-6 shadow-2xl">
        <h3 className="text-base font-semibold mb-1">تغییر وضعیت فایل</h3>
        <p className="text-xs text-muted-foreground mb-4">وضعیت فعلی: {toPersianPropertyFileStatus(propertyFile.status)}</p>
        <SelectField label="وضعیت جدید" value={next} onChange={(v) => setNext(v as typeof next)} options={allowed.map((s) => ({ label: toPersianPropertyFileStatus(s), value: s }))} />
        {next === "DRAFT" && canReject && (
          <div className="mt-4">
            <label htmlFor="propertyFile-rejection-reason" className="mb-1.5 block text-sm font-medium">دلیل بازگرداندن برای اصلاح</label>
            <textarea
              id="propertyFile-rejection-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value.slice(0, 1000))}
              maxLength={1000}
              rows={4}
              required
              aria-required="true"
              className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              placeholder="شرح دهید چه مواردی باید اصلاح شوند."
            />
            <p className="mt-1 text-xs text-muted-foreground">این توضیح برای کارشناس نمایش داده می‌شود.</p>
          </div>
        )}
        <div className="flex gap-2 justify-end mt-4">
          <Btn variant="secondary" size="sm" onClick={onClose}>انصراف</Btn>
          <Btn variant="primary" size="sm" disabled={next === "DRAFT" && canReject && !reason.trim()} onClick={() => { onApply(next, reason.trim()); onClose(); }}><Check size={13} />اعمال</Btn>
        </div>
      </Card>
    </div>
  );
}

export { StatusChangeModal };
