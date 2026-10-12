import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  GraduationCap,
  Loader2,
  Megaphone,
  School,
  UserCheck,
  Users,
  UserRoundCheck,
  UserPlus,
  RefreshCw,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import PageHeader from "../components/ui/PageHeader";
import { supabase } from "../lib/supabase";
import { getStudents } from "../lib/students";
import { getClasses } from "../lib/classes";
import { useSchool } from "../context/SchoolContext";

interface PrincipalStats {
  students: number;
  teachers: number;
  classes: number;
  subjects: number;
  attendanceRate: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  attendanceRecorded: number;
  enrolledStudents: number;
  assignedTeachers: number;
  coveredClasses: number;
  assessments: number;
  publishedAssessments: number;
  draftAssessments: number;
  pendingAdmissions: number;
}

interface AttendanceTrendPoint {
  label: string;
  date: string;
  rate: number;
  present: number;
  recorded: number;
}

interface AssessmentItem {
  id: string;
  title: string;
  assessmentDate: string;
  assessmentType: string;
  status: string;
  className: string;
  subjectName: string;
}

interface StatusCount {
  label: string;
  value: number;
}

interface AdmissionItem {
  id: string;
  name: string;
  status: string;
  createdAt: string;
}

interface SchoolSection {
  id: string;
  academic_year_id: string;
  name: string;
  display_order: number;
  is_active: boolean;
}

interface AnnouncementItem {
  id: string;
  title: string;
  createdAt: string;
}

interface ActivityItem {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  time: string;
}

interface AttentionItem {
  id: string;
  title: string;
  description: string;
  action: string;
  icon: typeof Users;
  onClick: () => void;
}

type SectionKey = "attendance" | "assessments" | "admissions" | "coverage";
type SectionStatus = "loading" | "ready" | "empty" | "error";

const initialSectionStatus: Record<SectionKey, SectionStatus> = {
  attendance: "loading",
  assessments: "loading",
  admissions: "loading",
  coverage: "loading",
};

const initialSectionErrors: Record<SectionKey, string> = {
  attendance: "",
  assessments: "",
  admissions: "",
  coverage: "",
};

const initialStats: PrincipalStats = {
  students: 0,
  teachers: 0,
  classes: 0,
  subjects: 0,
  attendanceRate: 0,
  present: 0,
  absent: 0,
  late: 0,
  excused: 0,
  attendanceRecorded: 0,
  enrolledStudents: 0,
  assignedTeachers: 0,
  coveredClasses: 0,
  assessments: 0,
  publishedAssessments: 0,
  draftAssessments: 0,
  pendingAdmissions: 0,
};

function getToday() {
  const date = new Date();

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function getDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatRelativeTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) {
    return `${diffMinutes} min${diffMinutes === 1 ? "" : "s"} ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours < 24) {
    return `${diffHours} hr${diffHours === 1 ? "" : "s"} ago`;
  }

  const diffDays = Math.floor(diffHours / 24);

  if (diffDays < 7) {
    return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getFirstNameFromUser(user: {
  user_metadata?: Record<string, unknown>;
  email?: string | null;
}) {
  const firstName = user.user_metadata?.first_name;

  if (typeof firstName === "string" && firstName.trim()) {
    return firstName.trim();
  }

  const fullName = user.user_metadata?.full_name;

  if (typeof fullName === "string" && fullName.trim()) {
    return fullName.trim().split(/\s+/)[0];
  }

  const email = user.email?.trim();

  if (email) {
    return email.split("@")[0] || "there";
  }

  return "there";
}

function mapJoinedName(value: unknown, fallback: string) {
  const joined = Array.isArray(value) ? value[0] : value;

  if (joined && typeof joined === "object") {
    const name = (joined as { name?: unknown }).name;

    if (typeof name === "string" && name.trim()) {
      return name.trim();
    }
  }

  return fallback;
}

function getAdmissionName(item: {
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
}) {
  return [item.first_name, item.middle_name, item.last_name]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    )
    .join(" ") || "Unnamed applicant";
}

function buildAttendanceTrend(
  records: Array<{
    attendance_date: string;
    status: string;
    student_id: string | null;
  }>,
) {
  const days: AttendanceTrendPoint[] = [];

  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);

    const key = getDateKey(date);
    const dayRecords = records.filter((record) =>
      record.attendance_date?.slice(0, 10) === key,
    );
    const uniqueStudents = new Set(
      dayRecords
        .map((record) => record.student_id)
        .filter((value): value is string => Boolean(value)),
    );
    const present = new Set(
      dayRecords
        .filter((record) => record.status === "present")
        .map((record) => record.student_id)
        .filter((value): value is string => Boolean(value)),
    ).size;
    const rate =
      uniqueStudents.size > 0 ? (present / uniqueStudents.size) * 100 : 0;

    days.push({
      label: date.toLocaleDateString("en-GB", { weekday: "short" }).slice(0, 3),
      date: key,
      rate,
      present,
      recorded: uniqueStudents.size,
    });
  }

  return days;
}

function TrendChart({ points }: { points: AttendanceTrendPoint[] }) {
  const width = 640;
  const height = 220;
  const paddingX = 28;
  const paddingTop = 20;
  const paddingBottom = 42;
  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingTop - paddingBottom;
  const maxRate = 100;

  const pointCoordinates = points.map((point, index) => ({
    x:
      paddingX +
      (points.length > 1 ? (index / (points.length - 1)) * innerWidth : innerWidth / 2),
    y: paddingTop + (1 - Math.min(100, Math.max(0, point.rate)) / maxRate) * innerHeight,
  }));

  const linePath = pointCoordinates
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");

  return (
    <div className="w-full overflow-hidden rounded-xl bg-violet-50/70 p-2 sm:p-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label="Attendance trend for the last seven days"
      >
        {[0, 25, 50, 75, 100].map((tick) => {
          const y = paddingTop + (1 - tick / 100) * innerHeight;

          return (
            <g key={tick}>
              <line
                x1={paddingX}
                x2={width - paddingX}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeOpacity="0.08"
              />
              <text
                x={6}
                y={y + 4}
                fontSize="10"
                fill="currentColor"
                opacity="0.55"
              >
                {tick}%
              </text>
            </g>
          );
        })}

        <path
          d={linePath}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-violet-600"
        />

        {pointCoordinates.map((point, index) => (
          <g key={points[index]?.date ?? index}>
            <circle
              cx={point.x}
              cy={point.y}
              r="5"
              fill="white"
              stroke="currentColor"
              strokeWidth="3"
              className="text-violet-600"
            />
            <text
              x={point.x}
              y={height - 14}
              textAnchor="middle"
              fontSize="10"
              fill="currentColor"
              opacity="0.65"
            >
              {points[index]?.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function SectionMessage({
  status,
  error,
  loadingLabel,
  emptyLabel,
  onRetry,
}: {
  status: SectionStatus;
  error?: string;
  loadingLabel: string;
  emptyLabel: string;
  onRetry: () => void;
}) {
  if (status === "loading") {
    return (
      <div className="flex min-h-36 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
        <Loader2 size={17} className="animate-spin text-violet-600" />
        {loadingLabel}
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-5">
        <div className="flex items-start gap-3">
          <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-red-800">Unable to load this section</p>
            <p className="mt-1 break-words text-sm text-red-700">
              {error || "Something went wrong while loading the data."}
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
            >
              <RefreshCw size={13} />
              Retry dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status === "empty") {
    return (
      <div className="min-h-36 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
        {emptyLabel}
      </div>
    );
  }

  return null;
}

function StatusBars({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: StatusCount[];
  emptyLabel: string;
}) {
  const maxValue = Math.max(...items.map((item) => item.value), 0);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <span className="text-xs text-slate-400">Live data</span>
      </div>

      {maxValue === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-7 text-center text-sm text-slate-500">
          {emptyLabel}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const percent = maxValue > 0 ? (item.value / maxValue) * 100 : 0;

            return (
              <div key={item.label}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-slate-600">{item.label}</span>
                  <span className="shrink-0 font-semibold text-slate-900">{item.value}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-violet-600 transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CoverageRow({
  label,
  value,
  percent,
}: {
  label: string;
  value: string;
  percent: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-slate-600">{label}</span>
        <span className="font-medium text-slate-900">{value}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-violet-600 transition-all duration-500"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    </div>
  );
}

function ActionButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-10 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
    >
      <span className="inline-flex min-w-0 items-center gap-2">
        <span className="text-violet-600">{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      <ArrowUpRight size={14} className="shrink-0 text-slate-400" />
    </button>
  );
}

function statusClasses(status: string) {
  switch (status) {
    case "Accepted":
    case "Enrolled":
    case "Published":
      return "bg-emerald-50 text-emerald-700";
    case "Rejected":
      return "bg-red-50 text-red-700";
    case "Draft":
    case "Pending":
    case "Under Review":
      return "bg-amber-50 text-amber-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

export default function PrincipalDashboard() {
  const navigate = useNavigate();
  const { school, configuration, isModuleEnabled } = useSchool();

  const showAdmissions = isModuleEnabled("admissions");
  const showStudents = isModuleEnabled("students");
  const showTeachers = isModuleEnabled("teachers");
  const showAcademics = isModuleEnabled("academics");
  const showTimetable = isModuleEnabled("timetable");
  const showAttendance = isModuleEnabled("attendance");
  const showAssessments = isModuleEnabled("assessments");
  const showStudentResults = isModuleEnabled("student_results");
  const showAnnouncements = isModuleEnabled("announcements");
  const moduleStateKey = JSON.stringify(configuration?.enabled_modules ?? {});
  const showStaffCoverage = showTeachers || showAcademics;
  const showSectionsOverview =
    showStudents || showTeachers || showAcademics || showAttendance || showAssessments;
  const sectionOverviewItems = [
    showStudents ? "students" : null,
    showAcademics ? "classes and subjects" : null,
    showTeachers ? "teachers" : null,
    showAttendance ? "attendance" : null,
    showAssessments ? "academic activity" : null,
  ].filter((item): item is string => Boolean(item));

  const [firstName, setFirstName] = useState("Principal");
  const [academicYearName, setAcademicYearName] = useState("");
  const [academicYearId, setAcademicYearId] = useState("");
  const [schoolSections, setSchoolSections] = useState<SchoolSection[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState("all");
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);
  const [stats, setStats] = useState<PrincipalStats>(initialStats);
  const [attendanceTrend, setAttendanceTrend] = useState<AttendanceTrendPoint[]>([]);
  const [assessmentStatusCounts, setAssessmentStatusCounts] = useState<StatusCount[]>([]);
  const [admissionStatusCounts, setAdmissionStatusCounts] = useState<StatusCount[]>([]);
  const [assessments, setAssessments] = useState<AssessmentItem[]>([]);
  const [admissions, setAdmissions] = useState<AdmissionItem[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [supplementalLoading, setSupplementalLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const [baseLoading, setBaseLoading] = useState(true);
  const [sectionStatus, setSectionStatus] = useState<Record<SectionKey, SectionStatus>>(
    initialSectionStatus,
  );
  const [sectionErrors, setSectionErrors] = useState<Record<SectionKey, string>>(
    initialSectionErrors,
  );

  const setSection = (
    key: SectionKey,
    status: SectionStatus,
    errorMessage = "",
  ) => {
    setSectionStatus((current) => ({ ...current, [key]: status }));
    setSectionErrors((current) => ({ ...current, [key]: errorMessage }));
  };

  async function loadDashboard() {
    if (!school?.id) {
      setBaseLoading(false);
      setSupplementalLoading(false);
      setSchoolSections([]);
      setSelectedSectionId("all");
      (Object.keys(initialSectionStatus) as SectionKey[]).forEach((key) =>
        setSection(key, "empty"),
      );
      return;
    }

    setBaseLoading(true);
    setSupplementalLoading(true);
    setError("");
    setStats(initialStats);
    setSectionStatus(initialSectionStatus);
    setSectionErrors(initialSectionErrors);
    setAttendanceTrend([]);
    setAssessmentStatusCounts([]);
    setAdmissionStatusCounts([]);
    setAssessments([]);
    setAdmissions([]);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (user) {
        setFirstName(getFirstNameFromUser(user));
      }

      const [
        academicYearsResult,
        studentsResult,
        teachersResult,
        subjectsResult,
        classesResult,
        academicSectionsResult,
        classSubjectsResult,
      ] = await Promise.all([
        supabase
          .from("academic_years")
          .select("id, name, start_date, end_date, is_active")
          .eq("school_id", school.id)
          .order("start_date", { ascending: false }),
        getStudents(school.id),
        supabase
          .from("teachers")
          .select("id, status")
          .eq("school_id", school.id),
        supabase
          .from("subjects")
          .select("id", { count: "exact", head: true })
          .eq("school_id", school.id)
          .eq("is_active", true),
        getClasses(school.id),
        supabase
          .from("academic_sections")
          .select("id, academic_year_id, name, display_order, is_active")
          .eq("school_id", school.id)
          .eq("is_active", true)
          .order("display_order", { ascending: true }),
        supabase
          .from("class_subjects")
          .select("id, class_id, subject_id")
          .eq("school_id", school.id),
      ]);

      const academicYearsError = academicYearsResult.error;
      const teachersError = teachersResult.error;
      const classesError = classesResult.error;
      const academicSectionsError = academicSectionsResult.error;
      const classSubjectsError = classSubjectsResult.error;
      const studentsError = studentsResult.error;
      const subjectsError = subjectsResult.error;

      if (academicYearsError) {
        throw academicYearsError;
      }
      if (studentsError || subjectsError || academicSectionsError || classSubjectsError) {
        throw studentsError ?? subjectsError ?? academicSectionsError ?? classSubjectsError;
      }

      const academicYears = academicYearsResult.data ?? [];
      const currentYear =
        academicYears.find((year) => year.is_active) ??
        null;

      setAcademicYearName(currentYear?.name ?? "");
      setAcademicYearId(currentYear?.id ?? "");

      const teachers = teachersResult.data ?? [];
      const students = studentsResult.data ?? [];
      const activeTeachers = teachers.filter(
        (teacher) => teacher.status !== "Inactive",
      );
      const allActiveClasses = (classesResult.data ?? []).filter((item) =>
        item.is_active &&
        (currentYear ? item.academic_year_id === currentYear.id : false),
      );
      const yearSections = (academicSectionsResult.data ?? [])
        .filter((section) => currentYear && section.academic_year_id === currentYear.id)
        .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));

      const currentYearStudents = students.filter(
        (student) =>
          student.status === "Active" &&
          student.academicYearId === currentYear?.id,
      );

      setSchoolSections(yearSections);

      const validSectionId =
        selectedSectionId !== "all" &&
        yearSections.some((section) => section.id === selectedSectionId)
          ? selectedSectionId
          : "all";

      if (validSectionId !== selectedSectionId) {
        setSelectedSectionId(validSectionId);
      }

      const selectedClassIds = new Set(
        allActiveClasses
          .filter(
            (item) =>
              validSectionId === "all" || item.academic_section_id === validSectionId,
          )
          .map((item) => item.id),
      );
      const activeClasses = allActiveClasses.filter((item) => selectedClassIds.has(item.id));
      const sectionStudents =
        validSectionId === "all"
          ? currentYearStudents
          : currentYearStudents.filter((student) =>
              activeClasses.some(
                (schoolClass) => schoolClass.name === student.className,
              ),
            );
      const selectedSubjectIds = new Set(
        (classSubjectsResult.data ?? [])
          .filter((item) => selectedClassIds.has(item.class_id))
          .map((item) => item.subject_id)
          .filter((value): value is string => Boolean(value)),
      );

      setStats((current) => ({
        ...current,
        students: sectionStudents.length,
        teachers: validSectionId === "all" ? activeTeachers.length : 0,
        classes: activeClasses.length,
        subjects:
          validSectionId === "all"
            ? subjectsResult.count ?? 0
            : selectedSubjectIds.size,
      }));

      setBaseLoading(false);

      const attendanceTask = (async () => {
        try {
          const { data, error: attendanceError } = await supabase
            .from("attendance_records")
            .select("id, student_id, class_id, attendance_date, status")
            .eq("school_id", school.id)
            .gte(
              "attendance_date",
              getDateKey(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)),
            )
            .lte("attendance_date", getToday());

          if (attendanceError) throw attendanceError;

          const attendanceRecords = (data ?? []).filter(
            (record) =>
              validSectionId === "all" ||
              (record.class_id ? selectedClassIds.has(record.class_id) : false),
          );
          const today = getToday();
          const todayRecords = attendanceRecords.filter(
            (record) => record.attendance_date?.slice(0, 10) === today,
          );
          const recordedStudentIds = new Set(
            todayRecords
              .map((record) => record.student_id)
              .filter((value): value is string => Boolean(value)),
          );
          const presentStudentIds = new Set(
            todayRecords
              .filter((record) => record.status === "present")
              .map((record) => record.student_id)
              .filter((value): value is string => Boolean(value)),
          );
          const present = presentStudentIds.size;
          const absent = todayRecords.filter(
            (record) => record.status === "absent",
          ).length;
          const late = todayRecords.filter(
            (record) => record.status === "late",
          ).length;
          const excused = todayRecords.filter(
            (record) => record.status === "excused",
          ).length;
          const attendanceRecorded = recordedStudentIds.size;

          setStats((current) => ({
            ...current,
            attendanceRate:
              attendanceRecorded > 0
                ? (present / attendanceRecorded) * 100
                : 0,
            present,
            absent,
            late,
            excused,
            attendanceRecorded,
          }));
          setAttendanceTrend(buildAttendanceTrend(attendanceRecords));

          if (attendanceRecords.length === 0) {
            setSection("attendance", "empty");
          } else {
            setSection("attendance", "ready");
          }
        } catch (err) {
          console.error("Failed to load Principal attendance:", err);
          setSection(
            "attendance",
            "error",
            err instanceof Error
              ? err.message
              : "Unable to load attendance data.",
          );
        }
      })();

      const coverageTask = (async () => {
        if (!currentYear) {
          setStats((current) => ({
            ...current,
            enrolledStudents: sectionStudents.length,
            assignedTeachers: 0,
            coveredClasses: 0,
          }));
          setSection(
            "coverage",
            "empty",
          );
          return;
        }

        if (teachersError || classesError) {
          const coverageError = teachersError ?? classesError;
          setSection(
            "coverage",
            "error",
            coverageError?.message ?? "Unable to load teacher or class data.",
          );
          return;
        }

        try {
          const [assignmentsResult, enrollmentsResult] = await Promise.all([
            supabase
              .from("teacher_assignments")
              .select("teacher_id, class_id")
              .eq("school_id", school.id)
              .eq("academic_year_id", currentYear.id),
            supabase
              .from("enrollments")
              .select("id, student_id, class_id, status")
              .eq("school_id", school.id)
              .eq("academic_year_id", currentYear.id)
              .eq("status", "Active"),
          ]);

          if (assignmentsResult.error) throw assignmentsResult.error;
          if (enrollmentsResult.error) throw enrollmentsResult.error;

          const assignmentsData = (assignmentsResult.data ?? []).filter(
            (item) => validSectionId === "all" || selectedClassIds.has(item.class_id),
          );
          const assignedTeacherIds = new Set(
            assignmentsData
              .map((item) => item.teacher_id)
              .filter((value): value is string => Boolean(value)),
          );
          const assignedTeachers = assignedTeacherIds.size;
          const coveredClasses = new Set(
            assignmentsData
              .map((item) => item.class_id)
              .filter((value): value is string => Boolean(value)),
          ).size;
          const enrolledStudents = new Set(
            (enrollmentsResult.data ?? [])
              .filter(
                (item) =>
                  validSectionId === "all" ||
                  (item as { class_id?: string | null }).class_id
                    ? selectedClassIds.has((item as { class_id: string }).class_id)
                    : false,
              )
              .map((item) => item.student_id)
              .filter((value): value is string => Boolean(value)),
          ).size;

          setStats((current) => ({
            ...current,
            students: enrolledStudents || sectionStudents.length,
            teachers: validSectionId === "all" ? activeTeachers.length : assignedTeachers,
            classes: activeClasses.length,
            subjects: validSectionId === "all" ? subjectsResult.count ?? 0 : selectedSubjectIds.size,
          }));

          setStats((current) => ({
            ...current,
            enrolledStudents: enrolledStudents || sectionStudents.length,
            assignedTeachers,
            coveredClasses,
          }));

          if (
            activeTeachers.length === 0 &&
            activeClasses.length === 0 &&
            assignmentsData.length === 0
          ) {
            setSection("coverage", "empty");
          } else {
            setSection("coverage", "ready");
          }
        } catch (err) {
          console.error("Failed to load Principal coverage:", err);
          setSection(
            "coverage",
            "error",
            err instanceof Error
              ? err.message
              : "Unable to load teacher and class coverage.",
          );
        }
      })();

      const assessmentsTask = (async () => {
        if (!currentYear) {
          setStats((current) => ({
            ...current,
            assessments: 0,
            publishedAssessments: 0,
            draftAssessments: 0,
          }));
          setSection("assessments", "empty");
          return;
        }

        try {
          const today = getToday();
          const [summaryResult, upcomingResult] = await Promise.all([
            supabase
              .from("assessments")
              .select("status, class_id")
              .eq("school_id", school.id)
              .eq("academic_year_id", currentYear.id),
            supabase
              .from("assessments")
              .select(
                "id, title, assessment_type, assessment_date, status, class_id, classes(name), subjects(name)",
              )
              .eq("school_id", school.id)
              .eq("academic_year_id", currentYear.id)
              .gte("assessment_date", today)
              .order("assessment_date", { ascending: true })
              .limit(5),
          ]);

          if (summaryResult.error) throw summaryResult.error;
          if (upcomingResult.error) throw upcomingResult.error;

          const assessmentSummaryData = (summaryResult.data ?? []).filter(
            (item) => validSectionId === "all" || selectedClassIds.has(item.class_id),
          );
          const assessmentData = (upcomingResult.data ?? []).filter(
            (item) => validSectionId === "all" || selectedClassIds.has(item.class_id),
          );
          const publishedAssessments = assessmentSummaryData.filter(
            (item) => item.status === "Published",
          ).length;
          const draftAssessments = assessmentSummaryData.filter(
            (item) => item.status === "Draft",
          ).length;

          setStats((current) => ({
            ...current,
            assessments: assessmentSummaryData.length,
            publishedAssessments,
            draftAssessments,
          }));

          const assessmentStatusOrder = ["Published", "Draft", "Other"];
          setAssessmentStatusCounts(
            assessmentStatusOrder.map((status) => {
              if (status === "Other") {
                return {
                  label: "Other",
                  value: assessmentSummaryData.filter(
                    (item) =>
                      item.status !== "Published" && item.status !== "Draft",
                  ).length,
                };
              }

              return {
                label: status,
                value: assessmentSummaryData.filter(
                  (item) => item.status === status,
                ).length,
              };
            }),
          );

          setAssessments(
            assessmentData.map((item) => ({
              id: item.id,
              title: item.title ?? "Untitled assessment",
              assessmentDate: item.assessment_date,
              assessmentType: item.assessment_type ?? "Assessment",
              status: item.status ?? "Draft",
              className: mapJoinedName(item.classes, "Unknown class"),
              subjectName: mapJoinedName(item.subjects, "Unknown subject"),
            })),
          );

          if (assessmentSummaryData.length === 0) {
            setSection("assessments", "empty");
          } else {
            setSection("assessments", "ready");
          }
        } catch (err) {
          console.error("Failed to load Principal assessments:", err);
          setSection(
            "assessments",
            "error",
            err instanceof Error
              ? err.message
              : "Unable to load assessment data.",
          );
        }
      })();

      const admissionsTask = (async () => {
        try {
          const [summaryResult, reviewResult] = await Promise.all([
            supabase
              .from("admission_applications")
              .select("status")
              .eq("school_id", school.id),
            supabase
              .from("admission_applications")
              .select("id, first_name, middle_name, last_name, status, created_at")
              .eq("school_id", school.id)
              .in("status", ["Pending", "Under Review"])
              .order("created_at", { ascending: false })
              .limit(5),
          ]);

          if (summaryResult.error) throw summaryResult.error;
          if (reviewResult.error) throw reviewResult.error;

          const admissionSummaryData = summaryResult.data ?? [];
          const pendingAdmissions = admissionSummaryData.filter(
            (item) => item.status === "Pending" || item.status === "Under Review",
          ).length;

          setStats((current) => ({ ...current, pendingAdmissions }));

          const admissionStatusOrder = [
            "Pending",
            "Under Review",
            "Accepted",
            "Enrolled",
            "Waitlisted",
            "Rejected",
            "Withdrawn",
            "Other",
          ];
          setAdmissionStatusCounts(
            admissionStatusOrder
              .map((status) => {
                if (status === "Other") {
                  return {
                    label: "Other",
                    value: admissionSummaryData.filter(
                      (item) =>
                        !admissionStatusOrder
                          .slice(0, -1)
                          .includes(item.status ?? ""),
                    ).length,
                  };
                }

                return {
                  label: status,
                  value: admissionSummaryData.filter(
                    (item) => item.status === status,
                  ).length,
                };
              })
              .filter((item) => item.value > 0),
          );

          setAdmissions(
            (reviewResult.data ?? []).map((item) => ({
              id: item.id,
              name: getAdmissionName(item),
              status: item.status ?? "Pending",
              createdAt: item.created_at,
            })),
          );

          if (admissionSummaryData.length === 0) {
            setSection("admissions", "empty");
          } else {
            setSection("admissions", "ready");
          }
        } catch (err) {
          console.error("Failed to load Principal admissions:", err);
          setSection(
            "admissions",
            "error",
            err instanceof Error
              ? err.message
              : "Unable to load admissions data.",
          );
        }
      })();

      const supplementalTask = (async () => {
        try {
          const [announcementsResult, recentStudentsResult] = await Promise.all([
            supabase
              .from("announcements")
              .select("id, title, created_at")
              .eq("school_id", school.id)
              .order("created_at", { ascending: false })
              .limit(5),
            supabase
              .from("students")
              .select(
                "id, student_id, first_name, middle_name, last_name, created_at",
              )
              .eq("school_id", school.id)
              .order("created_at", { ascending: false })
              .limit(4),
          ]);

          if (announcementsResult.error) throw announcementsResult.error;
          if (recentStudentsResult.error) throw recentStudentsResult.error;

          setAnnouncements(
            (announcementsResult.data ?? []).map((item) => ({
              id: item.id,
              title: item.title ?? "School announcement",
              createdAt: item.created_at,
            })),
          );

          const nextActivities: ActivityItem[] = [];

          for (const student of (showStudents ? recentStudentsResult.data ?? [] : [])) {
            nextActivities.push({
              id: `student-${student.id}`,
              title: "New student record",
              description:
                [student.first_name, student.middle_name, student.last_name]
                  .filter(Boolean)
                  .join(" ") ||
                student.student_id ||
                "Student added",
              createdAt: student.created_at,
              time: formatRelativeTime(student.created_at),
            });
          }

          for (const announcement of (showAnnouncements ? announcementsResult.data ?? [] : [])) {
            nextActivities.push({
              id: `announcement-${announcement.id}`,
              title: "School announcement",
              description: announcement.title || "New announcement",
              createdAt: announcement.created_at,
              time: formatRelativeTime(announcement.created_at),
            });
          }

          nextActivities.sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          );
          setActivities(nextActivities.slice(0, 5));
        } catch (err) {
          console.error("Failed to load Principal supplemental data:", err);
          setError(
            err instanceof Error
              ? `Some dashboard data could not be loaded: ${err.message}`
              : "Some dashboard data could not be loaded.",
          );
        } finally {
          setSupplementalLoading(false);
            }
      })();

      await Promise.all([
        attendanceTask,
        coverageTask,
        assessmentsTask,
        admissionsTask,
        supplementalTask,
      ]);

      setLastUpdatedAt(new Date());
    } catch (err) {
      console.error("Failed to load Principal dashboard:", err);
      setBaseLoading(false);
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load principal dashboard data.",
      );
      setSection("attendance", "error", "Dashboard context could not be loaded.");
      setSection("assessments", "error", "Dashboard context could not be loaded.");
      setSection("admissions", "error", "Dashboard context could not be loaded.");
      setSection("coverage", "error", "Dashboard context could not be loaded.");
    }
  }

  useEffect(() => {
    void loadDashboard();

    if (!school?.id) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      // Refresh the currently selected section without changing its selection.
      void loadDashboard();
    }, 5 * 60 * 1000);

    return () => window.clearInterval(intervalId);
  }, [school?.id, selectedSectionId, dashboardRefreshKey, moduleStateKey]);

  function handleOverviewClick() {
    // Always return to the all-sections view. Incrementing the refresh key
    // also forces a reload when Overview is already selected.
    setSelectedSectionId("all");
    setDashboardRefreshKey((current) => current + 1);
  }

  async function refreshDashboard() {
    setRefreshing(true);

    try {
      await loadDashboard();
    } finally {
      setRefreshing(false);
    }
  }

  const assignmentCoverage =
    stats.teachers > 0 ? (stats.assignedTeachers / stats.teachers) * 100 : 0;
  const classCoverage =
    stats.classes > 0 ? (stats.coveredClasses / stats.classes) * 100 : 0;
  const attendanceCoverage =
    stats.enrolledStudents > 0
      ? (stats.attendanceRecorded / stats.enrolledStudents) * 100
      : 0;

  const attendanceSummary = useMemo(() => {
    if (stats.attendanceRecorded === 0) {
      return "No attendance has been recorded yet today.";
    }

    return `${stats.attendanceRecorded} students recorded today`;
  }, [stats.attendanceRecorded]);

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];

    if (showAttendance && sectionStatus.attendance === "ready") {
      const totalStudents = stats.enrolledStudents || stats.students;
      const unrecorded = Math.max(0, totalStudents - stats.attendanceRecorded);

      if (totalStudents > 0 && unrecorded > 0) {
        items.push({
          id: "attendance",
          title: "Attendance still to record",
          description: `${unrecorded} of ${totalStudents} enrolled students do not have an attendance record today.`,
          action: "Open attendance",
          icon: ClipboardCheck,
          onClick: () => navigate("/attendance"),
        });
      }
    }

    if (showAssessments && sectionStatus.assessments === "ready" && stats.draftAssessments > 0) {
      items.push({
        id: "assessments",
        title: "Draft assessments",
        description: `${stats.draftAssessments} assessment${stats.draftAssessments === 1 ? "" : "s"} remain in Draft status.`,
        action: "Review assessments",
        icon: BookOpen,
        onClick: () => navigate("/assessments"),
      });
    }

    if (showAdmissions && sectionStatus.admissions === "ready" && stats.pendingAdmissions > 0) {
      items.push({
        id: "admissions",
        title: "Admissions awaiting review",
        description: `${stats.pendingAdmissions} application${stats.pendingAdmissions === 1 ? "" : "s"} are Pending or Under Review.`,
        action: "Open admissions",
        icon: UserPlus,
        onClick: () => navigate("/admissions"),
      });
    }

    if (showTeachers && showAcademics && sectionStatus.coverage === "ready" && stats.classes > stats.coveredClasses) {
      const uncoveredClasses = stats.classes - stats.coveredClasses;

      items.push({
        id: "coverage",
        title: "Classes without assignments",
        description: `${uncoveredClasses} active class${uncoveredClasses === 1 ? "" : "es"} do not currently have a teacher assignment.`,
        action: "Review academics",
        icon: UserRoundCheck,
        onClick: () => navigate("/academics"),
      });
    }

    return items;
  }, [
    navigate,
    showAttendance,
    showAssessments,
    showAdmissions,
    showTeachers,
    showAcademics,
    sectionStatus.attendance,
    sectionStatus.assessments,
    sectionStatus.admissions,
    sectionStatus.coverage,
    stats.enrolledStudents,
    stats.students,
    stats.attendanceRecorded,
    stats.draftAssessments,
    stats.pendingAdmissions,
    stats.classes,
    stats.coveredClasses,
  ]);

  const statCards = [
    ...(showStudents ? [{ label: "Students", value: baseLoading ? "—" : String(stats.enrolledStudents || stats.students), icon: Users }] : []),
    ...(showTeachers ? [{ label: "Teachers", value: baseLoading ? "—" : String(stats.teachers), icon: GraduationCap }] : []),
    ...(showAcademics ? [{ label: "Classes", value: baseLoading ? "—" : String(stats.classes), icon: School }] : []),
    ...(showAttendance ? [{ label: "Attendance today", value: sectionStatus.attendance === "loading" ? "—" : sectionStatus.attendance === "error" ? "!" : formatPercent(stats.attendanceRate), icon: UserCheck }] : []),
    ...(showAssessments ? [{ label: "Assessments", value: sectionStatus.assessments === "loading" ? "—" : sectionStatus.assessments === "error" ? "!" : String(stats.assessments), icon: ClipboardCheck }] : []),
    ...(showAdmissions ? [{ label: "Pending admissions", value: sectionStatus.admissions === "loading" ? "—" : sectionStatus.admissions === "error" ? "!" : String(stats.pendingAdmissions), icon: UserPlus }] : []),
  ];

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1400px]">
      <PageHeader
        eyebrow={academicYearName || "Principal overview"}
        title={`${getGreeting()}, ${firstName}`}
        description="Monitor the features enabled for your school from one place."
        actions={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {lastUpdatedAt && (
              <span className="text-xs text-slate-400">
                Updated {formatRelativeTime(lastUpdatedAt.toISOString())}
              </span>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={() => void refreshDashboard()}
              disabled={refreshing}
            >
              <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? "Refreshing..." : "Refresh"}
            </Button>
            {showStudents && (
              <Button type="button" onClick={() => navigate("/students")}>
                <Users size={16} />
                View students
              </Button>
            )}
          </div>
        }
      />

      {error && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card className={`mb-6 min-w-0 p-4 sm:p-5 ${!showSectionsOverview ? "hidden" : ""}`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <School size={18} className="shrink-0 text-violet-600" />
              <h2 className="text-sm font-semibold text-slate-900">School sections</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              View {sectionOverviewItems.join(", ")} by section.
            </p>
          </div>

          <div className="flex min-w-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={handleOverviewClick}
              className={[
                "inline-flex min-h-9 items-center rounded-lg border px-3 py-2 text-xs font-semibold transition",
                selectedSectionId === "all"
                  ? "border-violet-600 bg-violet-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700",
              ].join(" ")}
            >
              Overview
            </button>
            {schoolSections.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => setSelectedSectionId(section.id)}
                className={[
                  "inline-flex min-h-9 items-center rounded-lg border px-3 py-2 text-xs font-semibold transition",
                  selectedSectionId === section.id
                    ? "border-violet-600 bg-violet-600 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700",
                ].join(" ")}
              >
                {section.name}
              </button>
            ))}
          </div>
        </div>

        {selectedSectionId !== "all" && (
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-violet-100 bg-violet-50/50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-violet-600 shadow-sm">
                <GraduationCap size={17} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">
                  {schoolSections.find((section) => section.id === selectedSectionId)?.name ?? "Selected section"}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Section-specific dashboard data is active.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <div hidden={!showAcademics}>
              <Button
                size="sm"
                variant="secondary"
                type="button"
                onClick={() =>
                  navigate(
                    `/academics?academicYearId=${encodeURIComponent(academicYearId)}&sectionId=${encodeURIComponent(selectedSectionId)}`,
                  )
                }
              >
                Manage classes
              </Button>
              </div>
              <div hidden={!showTeachers}>
              <Button
                size="sm"
                variant="secondary"
                type="button"
                onClick={() => navigate(`/teachers?sectionId=${encodeURIComponent(selectedSectionId)}`)}
              >
                Manage teachers
              </Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {statCards.map((stat) => {
          const label = stat.label.toLowerCase();
          const tone = label.includes("attendance")
            ? { card: "border-emerald-100 bg-emerald-50", icon: "bg-emerald-100 text-emerald-700" }
            : label.includes("teacher") || label.includes("assessment")
              ? { card: "border-sky-100 bg-sky-50", icon: "bg-sky-100 text-sky-700" }
              : label.includes("class") || label.includes("admission")
                ? { card: "border-orange-100 bg-orange-50", icon: "bg-orange-100 text-orange-700" }
                : { card: "border-violet-100 bg-violet-50", icon: "bg-violet-100 text-violet-700" };
          const StatIcon = stat.icon;

          return (
            <Card key={stat.label} className={`min-w-0 p-5 ${tone.card}`}>
              <div className="flex items-start justify-between gap-3">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone.icon}`}>
                  <StatIcon size={19} strokeWidth={1.8} />
                </div>
              </div>
              <div className="mt-5">
                <div className="text-2xl font-semibold tracking-tight text-slate-900">
                  {stat.value}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  {stat.label}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {!baseLoading && attentionItems.length > 0 && (
        <Card className="mt-6 min-w-0 border-amber-200/70 bg-amber-50/40 p-4 sm:p-5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Needs your attention
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Items surfaced directly from the current school records.
              </p>
            </div>
            <span className="text-xs font-medium text-slate-500">
              {attentionItems.length} item{attentionItems.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {attentionItems.map((item) => {
              const Icon = item.icon;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.onClick}
                  className="group min-w-0 rounded-xl border border-orange-200 bg-white p-4 text-left transition hover:border-violet-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-orange-700">
                      <Icon size={17} />
                    </div>
                    <ArrowUpRight
                      size={15}
                      className="text-slate-300 transition group-hover:text-violet-600"
                    />
                  </div>

                  <p className="mt-3 break-words text-sm font-semibold text-slate-900">
                    {item.title}
                  </p>
                  <p className="mt-1 break-words text-xs leading-5 text-slate-500">
                    {item.description}
                  </p>
                  <span className="mt-3 inline-flex text-xs font-medium text-violet-600">
                    {item.action}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {!baseLoading &&
        (!showAttendance || sectionStatus.attendance === "ready" || sectionStatus.attendance === "empty") &&
        (!showAssessments || sectionStatus.assessments === "ready" || sectionStatus.assessments === "empty") &&
        (!showAdmissions || sectionStatus.admissions === "ready" || sectionStatus.admissions === "empty") &&
        (!(showTeachers && showAcademics) || sectionStatus.coverage === "ready" || sectionStatus.coverage === "empty") &&
        attentionItems.length === 0 && (
          <Card className="mt-6 min-w-0 border-emerald-200/70 bg-emerald-50/40 p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <CheckCircle2 size={17} />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-900">
                  No pending dashboard actions
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  There are no pending actions in the enabled modules currently surfaced by this dashboard.
                </p>
              </div>
            </div>
          </Card>
        )}

      <div hidden={!showAttendance && !showStaffCoverage} className={`mt-6 grid min-w-0 gap-6 ${showAttendance && showStaffCoverage ? "xl:grid-cols-3" : "xl:grid-cols-1"}`}>
        <Card className={`min-w-0 p-4 sm:p-6 ${!showAttendance ? "hidden" : ""} ${showStaffCoverage ? "xl:col-span-2" : ""}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900">Attendance trend</h2>
              <p className="mt-1 text-sm text-slate-500">Daily attendance rate across the last seven days.</p>
            </div>
            <button
              type="button"
              onClick={() => navigate("/attendance")}
              className="inline-flex shrink-0 items-center gap-1 self-start text-sm font-medium text-violet-600 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
            >
              Open attendance
              <ArrowUpRight size={14} />
            </button>
          </div>

          <div className="mt-6">
            {sectionStatus.attendance === "ready" ? (
              <TrendChart points={attendanceTrend} />
            ) : (
              <SectionMessage
                status={sectionStatus.attendance}
                error={sectionErrors.attendance}
                loadingLabel="Loading attendance data..."
                emptyLabel="No attendance has been recorded during the last seven days."
                onRetry={() => void loadDashboard()}
              />
            )}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniMetric label="Present" value={sectionStatus.attendance === "loading" ? "—" : sectionStatus.attendance === "error" ? "!" : String(stats.present)} />
            <MiniMetric label="Absent" value={sectionStatus.attendance === "loading" ? "—" : sectionStatus.attendance === "error" ? "!" : String(stats.absent)} />
            <MiniMetric label="Late" value={sectionStatus.attendance === "loading" ? "—" : sectionStatus.attendance === "error" ? "!" : String(stats.late)} />
            <MiniMetric label="Excused" value={sectionStatus.attendance === "loading" ? "—" : sectionStatus.attendance === "error" ? "!" : String(stats.excused)} />
          </div>

          <div className="mt-5">
            <CoverageRow
              label="Attendance coverage"
              value={sectionStatus.attendance === "loading" ? "—" : sectionStatus.attendance === "error" ? "Unavailable" : `${stats.attendanceRecorded} of ${stats.enrolledStudents || stats.students}`}
              percent={sectionStatus.attendance === "ready" ? attendanceCoverage : 0}
            />
            <p className="mt-2 text-xs text-slate-400">
              {sectionStatus.attendance === "error"
                ? "Attendance coverage is unavailable until the section loads successfully."
                : sectionStatus.attendance === "empty"
                  ? "Start recording attendance to populate this coverage metric."
                  : attendanceSummary}
            </p>
          </div>
        </Card>

        <Card className={`min-w-0 p-4 sm:p-6 ${!showStaffCoverage ? "hidden" : ""}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900">
                {showTeachers && showAcademics
                  ? "Staff & class coverage"
                  : showTeachers
                    ? "Staff coverage"
                    : "Class coverage"}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {showTeachers && showAcademics
                  ? "Current academic-year teacher assignments and class coverage."
                  : showTeachers
                    ? "Teacher assignments for the current academic year."
                    : "Class coverage for the current academic year."}
              </p>
            </div>
            <UserRoundCheck size={20} className="shrink-0 text-sky-600" />
          </div>

          <div className="mt-6">
            {sectionStatus.coverage === "ready" ? (
              <div className="space-y-5">
                <div hidden={!showTeachers}>
                  <CoverageRow
                    label="Teachers assigned"
                    value={`${stats.assignedTeachers} of ${stats.teachers}`}
                    percent={assignmentCoverage}
                  />
                </div>
                <div hidden={!showAcademics}>
                  <CoverageRow
                    label="Classes covered"
                    value={`${stats.coveredClasses} of ${stats.classes}`}
                    percent={classCoverage}
                  />
                </div>
              </div>
            ) : (
              <SectionMessage
                status={sectionStatus.coverage}
                error={sectionErrors.coverage}
                loadingLabel="Loading teacher and class coverage..."
                emptyLabel="No current academic-year teaching coverage is available yet."
                onRetry={() => void loadDashboard()}
              />
            )}
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <div hidden={!showAcademics}><MiniMetric label="Subjects" value={baseLoading ? "—" : String(stats.subjects)} /></div>
            <div hidden={!showTeachers}><MiniMetric label="Active teachers" value={baseLoading ? "—" : String(stats.teachers)} /></div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <div hidden={!showTeachers}><Button size="sm" variant="secondary" type="button" onClick={() => navigate("/teachers")}>
              Manage teachers
            </Button></div>
            <div hidden={!showAcademics}><Button size="sm" variant="secondary" type="button" onClick={() => navigate("/academics")}>
              Academics
            </Button></div>
          </div>
        </Card>
      </div>

      <div hidden={!showAssessments && !showAdmissions} className={`mt-6 grid min-w-0 gap-6 ${showAssessments && showAdmissions ? "lg:grid-cols-2" : "grid-cols-1"}`}>
        <Card className={`min-w-0 p-4 sm:p-6 ${!showAssessments ? "hidden" : ""}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900">Academic oversight</h2>
              <p className="mt-1 text-sm text-slate-500">Assessment workload for the current academic year.</p>
            </div>
            <BookOpen size={20} className="shrink-0 text-sky-600" />
          </div>

          <div className="mt-6 grid grid-cols-3 gap-3">
            <MiniMetric
              label="Total"
              value={
                sectionStatus.assessments === "loading"
                  ? "—"
                  : sectionStatus.assessments === "error"
                    ? "!"
                    : String(stats.assessments)
              }
            />
            <MiniMetric
              label="Published"
              value={
                sectionStatus.assessments === "loading"
                  ? "—"
                  : sectionStatus.assessments === "error"
                    ? "!"
                    : String(stats.publishedAssessments)
              }
            />
            <MiniMetric
              label="Drafts"
              value={
                sectionStatus.assessments === "loading"
                  ? "—"
                  : sectionStatus.assessments === "error"
                    ? "!"
                    : String(stats.draftAssessments)
              }
            />
          </div>

          <div className="mt-6">
            {sectionStatus.assessments === "ready" ? (
              <StatusBars
                title="Assessment status"
                items={assessmentStatusCounts}
                emptyLabel="No assessments have been created for this academic year yet."
              />
            ) : (
              <SectionMessage
                status={sectionStatus.assessments}
                error={sectionErrors.assessments}
                loadingLabel="Loading assessment data..."
                emptyLabel="No assessments have been created for this academic year yet."
                onRetry={() => void loadDashboard()}
              />
            )}
          </div>

          <div className="mt-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Upcoming assessments</h3>
                <p className="mt-1 text-xs text-slate-400">Next scheduled academic activities.</p>
              </div>
              <button
                type="button"
                onClick={() => navigate("/assessments")}
                className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-700"
              >
                View all
                <ArrowUpRight size={13} />
              </button>
            </div>

            <div className="space-y-2.5">
              {sectionStatus.assessments === "loading" ? (
                <SectionMessage
                  status="loading"
                  loadingLabel="Loading upcoming assessments..."
                  emptyLabel=""
                  onRetry={() => void loadDashboard()}
                />
              ) : sectionStatus.assessments === "error" ? (
                <SectionMessage
                  status="error"
                  error={sectionErrors.assessments}
                  loadingLabel=""
                  emptyLabel=""
                  onRetry={() => void loadDashboard()}
                />
              ) : assessments.length > 0 ? (
                assessments.map((assessment) => (
                  <div key={assessment.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{assessment.title}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {assessment.subjectName} · {assessment.className}
                        </p>
                      </div>
                      <span className="shrink-0 text-[11px] text-slate-400">{formatDate(assessment.assessmentDate)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600">{assessment.assessmentType}</span>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${statusClasses(assessment.status)}`}>{assessment.status}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 px-4 py-7 text-center text-sm text-slate-500">
                  No upcoming assessments found.
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card className={`min-w-0 p-4 sm:p-6 ${!showAdmissions ? "hidden" : ""}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900">School operations</h2>
              <p className="mt-1 text-sm text-slate-500">Admissions and day-to-day activity needing attention.</p>
            </div>
            <School size={20} className="shrink-0 text-orange-500" />
          </div>

          {sectionStatus.admissions !== "error" && (
            <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-amber-700">Admissions requiring review</p>
                <p className="mt-1 text-2xl font-semibold text-amber-900">
                  {sectionStatus.admissions === "loading" ? "—" : stats.pendingAdmissions}
                </p>
              </div>
              <UserPlus size={24} className="shrink-0 text-amber-700" />
            </div>
          )}

          <div className="mt-5 space-y-2.5">
            {sectionStatus.admissions === "loading" ? (
              <SectionMessage
                status="loading"
                loadingLabel="Loading admissions..."
                emptyLabel=""
                onRetry={() => void loadDashboard()}
              />
            ) : sectionStatus.admissions === "error" ? (
              <SectionMessage
                status="error"
                error={sectionErrors.admissions}
                loadingLabel=""
                emptyLabel=""
                onRetry={() => void loadDashboard()}
              />
            ) : admissions.length > 0 ? (
              admissions.map((admission) => (
                <div key={admission.id} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{admission.name}</p>
                    <p className="mt-1 text-xs text-slate-400">{formatRelativeTime(admission.createdAt)}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${statusClasses(admission.status)}`}>{admission.status}</span>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-7 text-center text-sm text-slate-500">
                No current admissions to review.
              </div>
            )}
          </div>

          <div className="mt-6">
            {sectionStatus.admissions === "ready" ? (
              <StatusBars
                title="Admissions pipeline"
                items={admissionStatusCounts}
                emptyLabel="No admission applications found."
              />
            ) : sectionStatus.admissions === "empty" ? (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                There are no admission applications in the system yet.
              </div>
            ) : null}
          </div>

          <Button size="sm" variant="secondary" type="button" className="mt-4" onClick={() => navigate("/admissions")}>
            Open admissions
            <ArrowUpRight size={14} />
          </Button>
        </Card>
      </div>

      <div hidden={!showStudents && !showAnnouncements} className={`mt-6 grid min-w-0 gap-6 ${showStudents && showAnnouncements ? "lg:grid-cols-2" : "grid-cols-1"}`}>
        <Card className={`min-w-0 p-4 sm:p-6 ${!showStudents && !showAnnouncements ? "hidden" : ""}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900">Recent activity</h2>
              <p className="mt-1 text-sm text-slate-500">The latest updates visible to school leadership.</p>
            </div>
            <UserCheck size={20} className="shrink-0 text-violet-600" />
          </div>

          <div className="mt-5 space-y-4">
            {supplementalLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
                <Loader2 size={16} className="animate-spin" />
                Loading activity...
              </div>
            ) : activities.length > 0 ? (
              activities.map((activity) => (
                <div key={activity.id} className="flex min-w-0 gap-3">
                  <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-violet-600" />
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium text-slate-900">{activity.title}</p>
                    <p className="mt-0.5 break-words text-xs text-slate-500">{activity.description}</p>
                    <p className="mt-1 text-[11px] text-slate-400">{activity.time}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-7 text-center text-sm text-slate-500">
                No recent activity yet.
              </div>
            )}
          </div>
        </Card>

        <Card className={`min-w-0 p-4 sm:p-6 ${!showAnnouncements ? "hidden" : ""}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900">School notices</h2>
              <p className="mt-1 text-sm text-slate-500">Recent announcements for the school community.</p>
            </div>
            <Megaphone size={20} className="shrink-0 text-sky-600" />
          </div>

          <div className="mt-5 space-y-4">
            {supplementalLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
                <Loader2 size={16} className="animate-spin" />
                Loading notices...
              </div>
            ) : announcements.length > 0 ? (
              announcements.map((announcement) => (
                <button
                  key={announcement.id}
                  type="button"
                  onClick={() => navigate("/announcements")}
                  className="block w-full border-b border-slate-100 pb-4 text-left last:border-0 last:pb-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                >
                  <p className="break-words text-sm font-medium text-slate-900">{announcement.title}</p>
                  <p className="mt-1 text-xs text-slate-400">{formatRelativeTime(announcement.createdAt)}</p>
                </button>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-7 text-center text-sm text-slate-500">
                No school notices yet.
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => navigate("/announcements")}
            className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-violet-600 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
          >
            Open announcements
            <ArrowUpRight size={14} />
          </button>
        </Card>
      </div>

      <Card className={`mt-6 min-w-0 p-4 sm:p-6 ${!(showStudents || showTeachers || showAttendance || showAssessments || showTimetable || showStudentResults || showAdmissions || showAnnouncements) ? "hidden" : ""}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">Principal quick access</h2>
            <p className="mt-1 text-sm text-slate-500">Common areas for daily school leadership work.</p>
          </div>
          <CheckCircle2 size={20} className="shrink-0 text-emerald-600" />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {showStudents && <ActionButton label="Students" icon={<Users size={15} />} onClick={() => navigate("/students")} />}
          {showTeachers && <ActionButton label="Teachers" icon={<GraduationCap size={15} />} onClick={() => navigate("/teachers")} />}
          {showAttendance && <ActionButton label="Attendance" icon={<ClipboardCheck size={15} />} onClick={() => navigate("/attendance")} />}
          {showAssessments && <ActionButton label="Assessments" icon={<BookOpen size={15} />} onClick={() => navigate("/assessments")} />}
          {showTimetable && <ActionButton label="Timetable" icon={<CalendarDays size={15} />} onClick={() => navigate("/timetable")} />}
          {showStudentResults && <ActionButton label="Student results" icon={<CheckCircle2 size={15} />} onClick={() => navigate("/student-results")} />}
          {showAdmissions && <ActionButton label="Admissions" icon={<UserPlus size={15} />} onClick={() => navigate("/admissions")} />}
          {showAnnouncements && <ActionButton label="Announcements" icon={<Megaphone size={15} />} onClick={() => navigate("/announcements")} />}
        </div>
      </Card>

      <div className="mt-4 text-xs text-slate-400">
        <span>Principal view</span>
        {academicYearName ? <span> · {academicYearName}</span> : null}
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}
