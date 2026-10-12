import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  GraduationCap,
  Loader2,
  Megaphone,
  Moon,
  Search,
  Save,
  Utensils,
  Users,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import PageHeader from "../components/ui/PageHeader";
import { useSchool } from "../context/SchoolContext";
import { supabase } from "../lib/supabase";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; details?: unknown; hint?: unknown };
    if (typeof value.message === "string" && value.message.trim()) return value.message;
    if (typeof value.details === "string" && value.details.trim()) return value.details;
    if (typeof value.hint === "string" && value.hint.trim()) return value.hint;
    try {
      return JSON.stringify(error);
    } catch {
      return "An unexpected error occurred.";
    }
  }
  return "An unexpected error occurred.";
}

interface Teacher {
  id: string;
  teacher_id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  email: string | null;
  photo_url: string | null;
  status: string | null;
}

type DashboardSectionType =
  | "creche"
  | "nursery"
  | "primary"
  | "lower_secondary"
  | "academic";

interface Assignment {
  id: string;
  academic_year_id: string;
  class_id: string;
  subject_id: string;
  academic_section_id: string | null;
  className: string;
  subjectName: string;
  academicYearName: string;
  sectionName: string;
}

interface TimetableEntry {
  id: string;
  class_id: string;
  subject_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  className: string;
  subjectName: string;
}

interface AttendanceRecord {
  id: string;
  student_id: string;
  class_id: string;
  status: string;
}

interface Announcement {
  id: string;
  title: string | null;
  created_at: string;
}

interface Assessment {
  id: string;
  title: string;
  assessment_type: string | null;
  assessment_date: string;
  max_marks: number;
  subject_id: string;
  class_id: string;
  status: "Draft" | "Published" | string;
  className: string;
  subjectName: string;
}

interface AcademicSection {
  id: string;
  name: string;
}

interface CrecheChild {
  id: string;
  studentId: string;
  name: string;
  classId: string;
  className: string;
  dateOfBirth: string | null;
  photoUrl: string | null;
}

interface CareRecordForm {
  mood: string;
  wellbeing: string;
  breakfast: boolean;
  morningSnack: boolean;
  lunch: boolean;
  feedingNotes: string;
  napStart: string;
  napEnd: string;
  napQuality: string;
  observation: string;
  hygieneNotes: string;
  incidentNotes: string;
  activityNotes: string;
  teacherNotes: string;
}

const emptyCareRecord: CareRecordForm = {
  mood: "",
  wellbeing: "",
  breakfast: false,
  morningSnack: false,
  lunch: false,
  feedingNotes: "",
  napStart: "",
  napEnd: "",
  napQuality: "",
  observation: "",
  hygieneNotes: "",
  incidentNotes: "",
  activityNotes: "",
  teacherNotes: "",
};

function getToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function getDayName(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date);
}

function formatTime(value: string) {
  if (!value) return "";
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function getDashboardSectionType(name: string | null | undefined): DashboardSectionType {
  const normalized = name?.trim().toLowerCase();

  if (normalized === "creche" || normalized === "crèche") return "creche";
  if (normalized === "nursery") return "nursery";
  if (normalized === "primary") return "primary";
  if (
    normalized === "lower secondary" ||
    normalized === "lower-secondary" ||
    normalized === "lower_secondary"
  ) {
    return "lower_secondary";
  }

  return "academic";
}

function getSectionLabel(sectionType: DashboardSectionType) {
  switch (sectionType) {
    case "creche":
      return "Creche";
    case "nursery":
      return "Nursery";
    case "primary":
      return "Primary";
    case "lower_secondary":
      return "Lower Secondary";
    default:
      return "Academic";
  }
}

function formatRelativeTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const diffMinutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes} min${diffMinutes === 1 ? "" : "s"} ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr${diffHours === 1 ? "" : "s"} ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;

  return formatDate(value.slice(0, 10));
}



export default function TeacherDashboard() {
  const navigate = useNavigate();
  const { school } = useSchool();

  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [sectionType, setSectionType] = useState<DashboardSectionType>("academic");
  const [sectionOptions, setSectionOptions] = useState<AcademicSection[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [activeAcademicYearId, setActiveAcademicYearId] = useState<string | null>(null);
  const [sectionChildren, setSectionChildren] = useState<CrecheChild[]>([]);
  const [sectionChildrenLoading, setSectionChildrenLoading] = useState(false);
  const [sectionChildrenError, setSectionChildrenError] = useState("");
  const [sectionChildrenSearch, setSectionChildrenSearch] = useState("");
  const [careChild, setCareChild] = useState<CrecheChild | null>(null);
  const [careDate, setCareDate] = useState(getToday());
  const [careForm, setCareForm] = useState<CareRecordForm>(emptyCareRecord);
  const [careLoading, setCareLoading] = useState(false);
  const [careSaving, setCareSaving] = useState(false);
  const [careError, setCareError] = useState("");
  const [timetable, setTimetable] = useState<TimetableEntry[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [enrollmentRows, setEnrollmentRows] = useState<Array<{ student_id: string; class_id: string }>>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadDashboard() {
    setLoading(true);
    setError("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user) throw new Error("You must be signed in to open the teacher dashboard.");
      if (!user.email) throw new Error("Your account does not have an email address.");

      // Use the authenticated school membership as the source of truth.
      // This is the same school-membership flow used by the timetable page
      // and avoids depending only on the AppLayout school context.
      const { data: membership, error: membershipError } = await supabase
        .from("school_members")
        .select("school_id, role")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();

      if (membershipError) throw membershipError;
      if (!membership?.school_id) {
        throw new Error("No school is associated with your account.");
      }

      const schoolId = membership.school_id;

      // Prefer the direct Auth -> teacher link. Matching by email alone is
      // unsafe because a school can contain duplicate/legacy teacher emails,
      // which makes maybeSingle() fail with:
      // "JSON object requested, multiple (or no) rows returned".
      let teacherData: any = null;
      let teacherError: any = null;

      const teacherByUser = await supabase
        .from("teachers")
        .select(
          "id, teacher_id, first_name, middle_name, last_name, email, photo_url, status",
        )
        .eq("school_id", schoolId)
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();

      if (teacherByUser.error) {
        teacherError = teacherByUser.error;
      } else {
        teacherData = teacherByUser.data;
      }

      // Legacy-safe fallback: if the teacher record has not been linked to
      // Auth yet, use the school email, but never allow duplicate rows to
      // break the dashboard.
      if (!teacherError && !teacherData) {
        const teacherByEmail = await supabase
          .from("teachers")
          .select(
            "id, teacher_id, first_name, middle_name, last_name, email, photo_url, status",
          )
          .eq("school_id", schoolId)
          .ilike("email", user.email)
          .order("id", { ascending: true })
          .limit(1)
          .maybeSingle();

        teacherData = teacherByEmail.data;
        teacherError = teacherByEmail.error;
      }

      if (teacherError) throw teacherError;

      if (!teacherData) {
        setTeacher(null);
        setAssignments([]);
        setSectionType("academic");
        setSectionOptions([]);
        setSelectedSectionId(null);
        setActiveAcademicYearId(null);
        setSectionChildren([]);
        setCareChild(null);
        setTimetable([]);
        setAttendance([]);
        setEnrollmentRows([]);
        setAssessments([]);
        throw new Error(
          `Your account is signed in as ${user.email}, but no teacher profile in this school uses that email. ` +
            "Make sure the teacher record email matches the invited account email.",
        );
      }

      const teacherRecord = teacherData as Teacher;
      setTeacher(teacherRecord);

      // Query teacher assignments without embedded PostgREST relationships.
      // The previous dashboard depended on three relationship joins here;
      // if one relationship is missing/ambiguous, the whole dashboard failed.
      const { data: rawAssignments, error: assignmentError } = await supabase
        .from("teacher_assignments")
        .select("id, academic_year_id, class_id, subject_id")
        .eq("school_id", schoolId)
        .eq("teacher_id", teacherRecord.id);

      if (assignmentError) throw assignmentError;

      const assignmentRows = rawAssignments ?? [];
      const classIds = Array.from(
        new Set(assignmentRows.map((item: any) => item.class_id).filter(Boolean)),
      );
      const subjectIds = Array.from(
        new Set(assignmentRows.map((item: any) => item.subject_id).filter(Boolean)),
      );
      const academicYearIds = Array.from(
        new Set(
          assignmentRows
            .map((item: any) => item.academic_year_id)
            .filter(Boolean),
        ),
      );

      // Section information is resolved from the assigned classes after the
      // class query, keeping the same non-embedded query strategy as the rest
      // of this dashboard.

      const [classesResult, subjectsResult, yearsResult] = await Promise.all([
        classIds.length > 0
          ? supabase
              .from("classes")
              .select("id, name, academic_year_id, academic_section_id")
              .eq("school_id", schoolId)
              .in("id", classIds)
          : Promise.resolve({ data: [], error: null }),
        subjectIds.length > 0
          ? supabase
              .from("subjects")
              .select("id, name")
              .eq("school_id", schoolId)
              .in("id", subjectIds)
          : Promise.resolve({ data: [], error: null }),
        academicYearIds.length > 0
          ? supabase
              .from("academic_years")
              .select("id, name, is_active")
              .eq("school_id", schoolId)
              .in("id", academicYearIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (classesResult.error) throw classesResult.error;
      if (subjectsResult.error) throw subjectsResult.error;
      if (yearsResult.error) throw yearsResult.error;

      const sectionIds = Array.from(
        new Set(
          (classesResult.data ?? [])
            .map((item: any) => item.academic_section_id)
            .filter(Boolean),
        ),
      );

      const sectionsResult =
        sectionIds.length > 0
          ? await supabase
              .from("academic_sections")
              .select("id, name")
              .eq("school_id", schoolId)
              .in("id", sectionIds)
          : { data: [], error: null };

      if (sectionsResult.error) throw sectionsResult.error;

      const classMap = new Map(
        (classesResult.data ?? []).map((item: any) => [item.id, item]),
      );
      const subjectMap = new Map(
        (subjectsResult.data ?? []).map((item: any) => [item.id, item]),
      );
      const yearMap = new Map(
        (yearsResult.data ?? []).map((item: any) => [item.id, item]),
      );
      const sectionMap = new Map(
        (sectionsResult.data ?? []).map((item: any) => [item.id, item]),
      );

      const mappedAssignments: Assignment[] = assignmentRows.map((item: any) => {
        const schoolClass = classMap.get(item.class_id);
        const subject = subjectMap.get(item.subject_id);
        const year = yearMap.get(item.academic_year_id);
        const academicSection = schoolClass?.academic_section_id
          ? sectionMap.get(schoolClass.academic_section_id)
          : null;

        return {
          id: item.id,
          academic_year_id: item.academic_year_id,
          class_id: item.class_id,
          subject_id: item.subject_id,
          academic_section_id: schoolClass?.academic_section_id ?? null,
          className: schoolClass?.name ?? "Unknown class",
          subjectName: subject?.name ?? "Unknown subject",
          academicYearName: year?.name ?? "Unknown academic year",
          sectionName: academicSection?.name ?? "Academic",
        };
      });

      setAssignments(mappedAssignments);

      const activeYear =
        (yearsResult.data ?? []).find((year: any) => year.is_active) ??
        (yearsResult.data ?? [])[0] ??
        null;
      const activeYearId = activeYear?.id ?? null;
      setActiveAcademicYearId(activeYearId);

      const sectionAssignments = activeYearId
        ? mappedAssignments.filter((assignment) => assignment.academic_year_id === activeYearId)
        : mappedAssignments;
      const distinctSectionIds = Array.from(
        new Set(
          sectionAssignments
            .map((assignment) => assignment.academic_section_id)
            .filter(Boolean),
        ),
      ) as string[];

      const distinctSections = distinctSectionIds
        .map((id) => sectionMap.get(id))
        .filter(Boolean) as AcademicSection[];

      setSectionOptions(distinctSections);

      // A teacher assigned to one section is automatically placed in that
      // section's workflow. If multiple sections are assigned, the first
      // section in the active academic year is selected; the teacher can
      // switch context without changing their assignments.
      const initialSectionId =
        selectedSectionId && distinctSectionIds.includes(selectedSectionId)
          ? selectedSectionId
          : distinctSectionIds[0] ?? null;

      setSelectedSectionId(initialSectionId);

      const initialSectionName = initialSectionId
        ? sectionMap.get(initialSectionId)?.name
        : null;

      setSectionType(getDashboardSectionType(initialSectionName));

      // These are intentionally loaded independently. A problem in an optional
      // dashboard section should not make the whole teacher dashboard unusable.
      const [
        timetableResult,
        attendanceResult,
        announcementsResult,
        assessmentsResult,
        enrollmentResult,
      ] = await Promise.all([
        activeYearId
          ? supabase
              .from("timetable_entries")
              .select(
                "id, class_id, subject_id, day_of_week, start_time, end_time",
              )
              .eq("school_id", schoolId)
              .eq("academic_year_id", activeYearId)
              .eq("teacher_id", teacherRecord.id)
              .order("start_time", { ascending: true })
          : Promise.resolve({ data: [], error: null }),

        classIds.length > 0
          ? supabase
              .from("attendance_records")
              .select("id, student_id, class_id, status")
              .eq("school_id", schoolId)
              .eq("attendance_date", getToday())
              .in("class_id", classIds)
          : Promise.resolve({ data: [], error: null }),

        supabase
          .from("announcements")
          .select("id, title, created_at")
          .eq("school_id", schoolId)
          .order("created_at", { ascending: false })
          .limit(4),

        activeYearId && classIds.length > 0 && subjectIds.length > 0
          ? supabase
              .from("assessments")
              .select(
                "id, title, assessment_type, assessment_date, max_marks, subject_id, class_id, status",
              )
              .eq("school_id", schoolId)
              .eq("academic_year_id", activeYearId)
              .in("class_id", classIds)
              .in("subject_id", subjectIds)
              .order("assessment_date", { ascending: false })
              .limit(6)
          : Promise.resolve({ data: [], error: null }),

        activeYearId && classIds.length > 0
          ? supabase
              .from("enrollments")
              .select("id, student_id, class_id, status")
              .eq("school_id", schoolId)
              .eq("academic_year_id", activeYearId)
              .eq("status", "Active")
              .in("class_id", classIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      // Keep the dashboard useful even when an optional section is denied by
      // RLS or is temporarily unavailable. Surface the exact section instead
      // of replacing the entire dashboard with a generic error.
      const optionalWarnings: string[] = [];

      if (timetableResult.error) {
        optionalWarnings.push(`Timetable: ${getErrorMessage(timetableResult.error)}`);
      }
      if (attendanceResult.error) {
        optionalWarnings.push(`Attendance: ${getErrorMessage(attendanceResult.error)}`);
      }
      if (announcementsResult.error) {
        optionalWarnings.push(
          `Announcements: ${getErrorMessage(announcementsResult.error)}`,
        );
      }
      if (assessmentsResult.error) {
        optionalWarnings.push(`Assessments: ${getErrorMessage(assessmentsResult.error)}`);
      }
      if (enrollmentResult.error) {
        optionalWarnings.push(`Students: ${getErrorMessage(enrollmentResult.error)}`);
      }

      const mappedTimetable: TimetableEntry[] = (timetableResult.data ?? []).map(
        (item: any) => ({
          id: item.id,
          class_id: item.class_id,
          subject_id: item.subject_id,
          day_of_week: item.day_of_week,
          start_time: item.start_time,
          end_time: item.end_time,
          className: classMap.get(item.class_id)?.name ?? "Unknown class",
          subjectName: subjectMap.get(item.subject_id)?.name ?? "Unknown subject",
        }),
      );

      setTimetable(mappedTimetable);
      setAttendance((attendanceResult.data ?? []) as AttendanceRecord[]);
      setAnnouncements((announcementsResult.data ?? []) as Announcement[]);

      const assignmentMap = new Map(
        mappedAssignments.map((assignment) => [
          `${assignment.class_id}:${assignment.subject_id}`,
          assignment,
        ]),
      );

      const mappedAssessments: Assessment[] = (assessmentsResult.data ?? []).map(
        (item: any) => {
          const assignment = assignmentMap.get(`${item.class_id}:${item.subject_id}`);
          return {
            id: item.id,
            title: item.title,
            assessment_type: item.assessment_type,
            assessment_date: item.assessment_date,
            max_marks: Number(item.max_marks ?? 0),
            subject_id: item.subject_id,
            class_id: item.class_id,
            status: item.status,
            className: assignment?.className ?? classMap.get(item.class_id)?.name ?? "Unknown class",
            subjectName:
              assignment?.subjectName ??
              subjectMap.get(item.subject_id)?.name ??
              "Unknown subject",
          };
        },
      );

      setAssessments(mappedAssessments);

      setEnrollmentRows(
        (enrollmentResult.data ?? []).map((enrollment: any) => ({
          student_id: enrollment.student_id,
          class_id: enrollment.class_id,
        })),
      );

      if (optionalWarnings.length > 0) {
        setError(`Some dashboard sections could not be loaded: ${optionalWarnings.join(" • ")}`);
      }
    } catch (err) {
      console.error("Failed to load teacher dashboard:", err);
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, [school?.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadAssignedChildren() {
      if ((sectionType !== "creche" && sectionType !== "nursery") || !school?.id || !activeAcademicYearId) {
        setSectionChildren([]);
        setSectionChildrenError("");
        return;
      }

      const classIds = Array.from(
        new Set(
          assignments
            .filter(
              (assignment) =>
                assignment.academic_section_id === selectedSectionId &&
                assignment.academic_year_id === activeAcademicYearId,
            )
            .map((assignment) => assignment.class_id),
        ),
      );

      if (classIds.length === 0) {
        setSectionChildren([]);
        setSectionChildrenError("");
        return;
      }

      setSectionChildrenLoading(true);
      setSectionChildrenError("");

      try {
        const [enrollmentResult, classResult] = await Promise.all([
          supabase
            .from("enrollments")
            .select(
              `id, student_id, class_id, academic_year_id, status, students (
                id, student_id, first_name, middle_name, last_name, date_of_birth, photo_url
              )`,
            )
            .eq("school_id", school.id)
            .eq("academic_year_id", activeAcademicYearId)
            .eq("status", "Active")
            .in("class_id", classIds),
          supabase
            .from("classes")
            .select("id, name")
            .eq("school_id", school.id)
            .in("id", classIds),
        ]);

        if (enrollmentResult.error) throw enrollmentResult.error;
        if (classResult.error) throw classResult.error;

        const classMap = new Map(
          (classResult.data ?? []).map((item: any) => [item.id, item.name]),
        );

        const children: CrecheChild[] = (enrollmentResult.data ?? [])
          .map((enrollment: any) => {
            const student = Array.isArray(enrollment.students)
              ? enrollment.students[0]
              : enrollment.students;

            if (!student) return null;

            return {
              id: student.id,
              studentId: student.student_id ?? "—",
              name: [student.first_name, student.middle_name, student.last_name]
                .filter(Boolean)
                .join(" "),
              classId: enrollment.class_id,
              className: classMap.get(enrollment.class_id) ?? "Unknown class",
              dateOfBirth: student.date_of_birth ?? null,
              photoUrl: student.photo_url ?? null,
            };
          })
          .filter(Boolean) as CrecheChild[];

        const uniqueChildren = Array.from(
          new Map(children.map((child) => [child.id, child])).values(),
        ).sort((a, b) => a.name.localeCompare(b.name));

        if (!cancelled) setSectionChildren(uniqueChildren);
      } catch (err) {
        if (!cancelled) {
          setSectionChildren([]);
          setSectionChildrenError(getErrorMessage(err));
        }
      } finally {
        if (!cancelled) setSectionChildrenLoading(false);
      }
    }

    void loadAssignedChildren();
    return () => {
      cancelled = true;
    };
  }, [school?.id, sectionType, selectedSectionId, activeAcademicYearId, assignments]);

  async function openCareRecord(child: CrecheChild) {
    if (!school?.id || !teacher) return;

    setCareChild(child);
    setCareDate(getToday());
    setCareForm(emptyCareRecord);
    setCareError("");
    setCareLoading(true);

    try {
      const { data, error: recordError } = await supabase
        .from("creche_daily_care_records")
        .select(
          "mood, wellbeing, breakfast, morning_snack, lunch, feeding_notes, nap_start, nap_end, nap_quality, observation, hygiene_notes, incident_notes, activity_notes, teacher_notes",
        )
        .eq("school_id", school.id)
        .eq("student_id", child.id)
        .eq("class_id", child.classId)
        .eq("care_date", getToday())
        .maybeSingle();

      if (recordError) throw recordError;

      if (data) {
        setCareForm({
          mood: data.mood ?? "",
          wellbeing: data.wellbeing ?? "",
          breakfast: Boolean(data.breakfast),
          morningSnack: Boolean(data.morning_snack),
          lunch: Boolean(data.lunch),
          feedingNotes: data.feeding_notes ?? "",
          napStart: data.nap_start ?? "",
          napEnd: data.nap_end ?? "",
          napQuality: data.nap_quality ?? "",
          observation: data.observation ?? "",
          hygieneNotes: data.hygiene_notes ?? "",
          incidentNotes: data.incident_notes ?? "",
          activityNotes: data.activity_notes ?? "",
          teacherNotes: data.teacher_notes ?? "",
        });
      }
    } catch (err) {
      setCareError(getErrorMessage(err));
    } finally {
      setCareLoading(false);
    }
  }

  async function saveCareRecord() {
    if (!school?.id || !teacher || !careChild || !activeAcademicYearId) return;

    setCareSaving(true);
    setCareError("");

    try {
      const payload = {
        school_id: school.id,
        academic_year_id: activeAcademicYearId,
        class_id: careChild.classId,
        student_id: careChild.id,
        teacher_id: teacher.id,
        care_date: careDate,
        mood: careForm.mood || null,
        wellbeing: careForm.wellbeing || null,
        breakfast: careForm.breakfast,
        morning_snack: careForm.morningSnack,
        lunch: careForm.lunch,
        feeding_notes: careForm.feedingNotes || null,
        nap_start: careForm.napStart || null,
        nap_end: careForm.napEnd || null,
        nap_quality: careForm.napQuality || null,
        observation: careForm.observation || null,
        hygiene_notes: careForm.hygieneNotes || null,
        incident_notes: careForm.incidentNotes || null,
        activity_notes: careForm.activityNotes || null,
        teacher_notes: careForm.teacherNotes || null,
      };

      const { error: saveError } = await supabase
        .from("creche_daily_care_records")
        .upsert(payload, { onConflict: "school_id,student_id,class_id,care_date" });

      if (saveError) throw saveError;

      setCareChild(null);
    } catch (err) {
      setCareError(getErrorMessage(err));
    } finally {
      setCareSaving(false);
    }
  }

  const filteredSectionChildren = useMemo(() => {
    const query = sectionChildrenSearch.trim().toLowerCase();
    if (!query) return sectionChildren;
    return sectionChildren.filter(
      (child) =>
        child.name.toLowerCase().includes(query) ||
        child.studentId.toLowerCase().includes(query) ||
        child.className.toLowerCase().includes(query),
    );
  }, [sectionChildren, sectionChildrenSearch]);

  const selectedSectionAssignments = useMemo(
    () => assignments.filter((assignment) =>
      (!activeAcademicYearId || assignment.academic_year_id === activeAcademicYearId) &&
      (!selectedSectionId || assignment.academic_section_id === selectedSectionId),
    ),
    [assignments, selectedSectionId, activeAcademicYearId],
  );

  const selectedClassIds = useMemo(
    () => new Set(selectedSectionAssignments.map((assignment) => assignment.class_id)),
    [selectedSectionAssignments],
  );
  const selectedSectionClassCount = selectedClassIds.size;
  const selectedSectionSubjectCount = new Set(
    selectedSectionAssignments.map((assignment) => assignment.subject_id).filter(Boolean),
  ).size;
  const selectedSectionStudentCount = new Set(
    enrollmentRows.filter((enrollment) => selectedClassIds.has(enrollment.class_id))
      .map((enrollment) => enrollment.student_id),
  ).size;
  const selectedSectionAttendance = useMemo(
    () => attendance.filter((record) => selectedClassIds.has(record.class_id)),
    [attendance, selectedClassIds],
  );
  const selectedAttendanceRecorded = new Set(
    selectedSectionAttendance.map((record) => record.student_id),
  ).size;
  const selectedAttendancePresent = selectedSectionAttendance.filter(
    (record) => record.status?.toLowerCase() === "present",
  ).length;
  const selectedAttendanceRate = selectedAttendanceRecorded > 0
    ? (selectedAttendancePresent / selectedAttendanceRecorded) * 100
    : 0;
  const selectedSectionTimetable = useMemo(
    () => timetable.filter((entry) => selectedClassIds.has(entry.class_id)),
    [timetable, selectedClassIds],
  );
  const selectedSectionAssessments = useMemo(
    () => assessments.filter((assessment) => selectedClassIds.has(assessment.class_id)),
    [assessments, selectedClassIds],
  );

  const sectionLabel = getSectionLabel(sectionType);
  const isEarlyYears = sectionType === "creche" || sectionType === "nursery";
  const sectionDescription =
    sectionType === "creche"
      ? "Care, wellbeing, daily routines and activities for children in your care."
      : sectionType === "nursery"
        ? "Early-years learning, classroom routines, observations and child development."
        : "Your classes, timetable, attendance and academic work in one place.";

  const today = getDayName();

  const todayLessons = useMemo(
    () =>
      selectedSectionTimetable
        .filter((entry) => entry.day_of_week.toLowerCase() === today.toLowerCase())
        .sort((a, b) => a.start_time.localeCompare(b.start_time)),
    [selectedSectionTimetable, today],
  );

  const upcomingLessons = useMemo(
    () => selectedSectionTimetable.filter((entry) => entry.day_of_week.toLowerCase() !== today.toLowerCase()).slice(0, 5),
    [selectedSectionTimetable, today],
  );

  const attendanceLabel =
    selectedAttendanceRecorded > 0
      ? `${selectedAttendanceRecorded} students recorded today`
      : "No attendance recorded yet today";

  const statCards = isEarlyYears
    ? [
        {
          label: sectionType === "creche" ? "Children under care" : "Nursery children",
          value: loading || sectionChildrenLoading ? "—" : String(sectionChildren.length),
          icon: Users,
        },
        {
          label: "Assigned classes",
          value: loading ? "—" : String(selectedSectionClassCount),
          icon: GraduationCap,
        },
        {
          label: "Attendance recorded",
          value: loading ? "—" : String(selectedAttendanceRecorded),
          icon: ClipboardCheck,
        },
        {
          label: "Attendance rate",
          value: loading ? "—" : `${selectedAttendanceRate.toFixed(1)}%`,
          icon: CheckCircle2,
        },
      ]
    : [
        { label: "My classes", value: loading ? "—" : String(selectedSectionClassCount), icon: GraduationCap },
        { label: "Subjects", value: loading ? "—" : String(selectedSectionSubjectCount), icon: BookOpen },
        { label: "Students", value: loading ? "—" : String(selectedSectionStudentCount), icon: Users },
        {
          label: "Attendance",
          value: loading ? "—" : `${selectedAttendanceRate.toFixed(1)}%`,
          icon: CheckCircle2,
        },
      ];

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1400px]">
      <PageHeader
        eyebrow={`${sectionLabel} teacher workspace`}
        title={teacher ? `Good morning, ${teacher.first_name}` : "Teacher dashboard"}
        description={sectionDescription}
        actions={
          <Button type="button" onClick={() => navigate("/attendance")}>
            <ClipboardCheck size={16} />
            Take attendance
          </Button>
        }
      />

      {error && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      <Card className="mb-6 min-w-0 p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
              Teaching section
            </p>
            <h2 className="mt-1 text-base font-semibold text-slate-900">{sectionLabel}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {sectionType === "creche"
                ? "Creche workflows are focused on care, wellbeing, routines and child observations."
                : sectionType === "nursery"
                  ? "Nursery workflows are focused on early-years learning and child development."
                  : "Academic teaching workflows are enabled for this section."}
            </p>
          </div>

          {sectionOptions.length > 1 && (
            <label className="flex shrink-0 flex-col gap-1 text-xs font-medium text-slate-600">
              Dashboard context
              <select
                value={selectedSectionId ?? ""}
                onChange={(event) => {
                  const nextId = event.target.value || null;
                  setSelectedSectionId(nextId);
                  const nextSection = sectionOptions.find((section) => section.id === nextId);
                  setSectionType(getDashboardSectionType(nextSection?.name));
                }}
                className="min-w-[190px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              >
                {sectionOptions.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </Card>

      {(sectionType === "creche" || sectionType === "nursery") && (
        <Card className="mb-6 min-w-0 p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                  <Users size={18} />
                </div>
                <h2 className="text-sm font-semibold text-slate-900">
                  {sectionType === "creche" ? "Children under care" : "My Nursery children"}
                </h2>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {sectionType === "creche"
                  ? "Children enrolled in your assigned Creche classes. Open a child to record today's care."
                  : "Children enrolled in your assigned Nursery classes. Open a child to review their student profile."}
              </p>
            </div>
            <span className="inline-flex w-fit items-center rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
              {sectionChildren.length} {sectionChildren.length === 1 ? "child" : "children"}
            </span>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={sectionChildrenSearch}
                onChange={(event) => setSectionChildrenSearch(event.target.value)}
                placeholder="Search by child name, student ID or class"
                className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </div>

          {sectionChildrenError && (
            <div className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
              {sectionChildrenError}
            </div>
          )}

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sectionChildrenLoading ? (
              <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-sm text-slate-500 sm:col-span-2 lg:col-span-3">
                <Loader2 size={16} className="animate-spin" />
                Loading children under care...
              </div>
            ) : filteredSectionChildren.length > 0 ? (
              filteredSectionChildren.map((child) => (
                <button
                  key={child.id}
                  type="button"
                  onClick={() => {
                    if (sectionType === "creche") void openCareRecord(child);
                    else navigate(`/students/${child.id}`);
                  }}
                  className="group flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-indigo-200 hover:bg-indigo-50/40 hover:shadow-sm"
                >
                  {child.photoUrl ? (
                    <img src={child.photoUrl} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-sm font-semibold text-indigo-700">
                      {child.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{child.name}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {child.studentId} • {child.className}
                    </p>
                    <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 group-hover:text-indigo-700">
                      {sectionType === "creche" ? "Open daily care" : "View child profile"} <ArrowUpRight size={12} />
                    </span>
                  </div>
                </button>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center sm:col-span-2 lg:col-span-3">
                <Users size={22} className="mx-auto text-slate-300" />
                <p className="mt-2 text-sm font-medium text-slate-700">No children found</p>
                <p className="mt-1 text-xs text-slate-400">
                  Make sure active students are enrolled in the Creche class assigned to you.
                </p>
              </div>
            )}
          </div>
        </Card>
      )}

      {sectionType === "nursery" && (
        <Card className="mb-6 min-w-0 p-4 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Nursery classroom focus</h2>
              <p className="mt-1 text-sm text-slate-500">
                Nursery teachers can use early-years learning, observations, routines and child-development workflows.
              </p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
              <GraduationCap size={20} />
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Children & classroom", "View children and their classroom assignments."],
              ["Daily observations", "Record learning, behaviour and developmental observations."],
              ["Activities", "Capture classroom activities and participation."],
              ["Attendance", "Record daily attendance for the Nursery class."],
              ["Wellbeing", "Record wellbeing or care notes when needed."],
              ["Parent communication", "Keep notes for relevant parent communication and follow-up."],
            ].map(([title, description]) => (
              <div key={title} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <p className="text-sm font-semibold text-slate-900">{title}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((stat) => {
          const label = stat.label.toLowerCase();
          const tone = label.includes("attendance")
            ? { icon: "bg-emerald-100 text-emerald-700" }
            : label.includes("class")
              ? { icon: "bg-orange-100 text-orange-700" }
              : label.includes("subject") || label.includes("student") || label.includes("children")
                ? { icon: "bg-violet-100 text-violet-700" }
                : { icon: "bg-sky-100 text-sky-700" };
          const StatIcon = stat.icon;

          return (
            <div
              key={stat.label}
              className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone.icon}`}>
                  <StatIcon size={19} />
                </div>
              </div>
              <p className="mt-5 text-2xl font-semibold tracking-tight text-slate-900">
                {stat.value}
              </p>
              <p className="mt-1 text-sm text-slate-500">{stat.label}</p>
            </div>
          );
        })}
      </div>

      {isEarlyYears && (
        <Card className="mt-6 min-w-0 p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Today's focus</p>
              <h2 className="mt-1 text-base font-semibold text-slate-900">
                {sectionType === "creche" ? "Care, comfort and daily routines" : "Early learning and child development"}
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                {sectionType === "creche"
                  ? "Record attendance, mood, meals, rest, activities and handover notes for children assigned to your class."
                  : "Focus on attendance, play-based learning, classroom activities and observations for children assigned to your class."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => navigate("/attendance")}>
                <ClipboardCheck size={15} />
                Take attendance
              </Button>
              <Button type="button" variant="secondary" onClick={() => navigate("/timetable")}>
                <CalendarDays size={15} />
                View daily routine
              </Button>
              <Button type="button" variant="secondary" onClick={() => navigate("/parents")}>
                <Users size={15} />
                Parents & guardians
              </Button>
            </div>
          </div>
        </Card>
      )}

      {!isEarlyYears && (
      <div className="mt-6 grid min-w-0 gap-6 xl:grid-cols-3">
        <Card className="min-w-0 p-4 sm:p-6 xl:col-span-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900">Today's classes</h2>
              <p className="mt-1 text-sm text-slate-500">Your scheduled lessons for {today}.</p>
            </div>
            <button
              type="button"
              onClick={() => navigate("/timetable")}
              className="inline-flex shrink-0 items-center gap-1 self-start text-sm font-medium text-indigo-600 hover:text-indigo-700"
            >
              Full timetable
              <ArrowUpRight size={14} />
            </button>
          </div>

          <div className="mt-6 space-y-3">
            {loading ? (
              <div className="flex items-center gap-2 py-5 text-sm text-slate-500">
                <Loader2 size={16} className="animate-spin" />
                Loading today's classes...
              </div>
            ) : todayLessons.length > 0 ? (
              todayLessons.map((lesson) => (
                <div
                  key={lesson.id}
                  className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:flex-row sm:items-center"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                    <Clock3 size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="text-sm font-semibold text-slate-900">{lesson.subjectName}</p>
                      <span className="text-xs text-slate-400">•</span>
                      <p className="text-xs font-medium text-slate-500">{lesson.className}</p>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatTime(lesson.start_time)} – {formatTime(lesson.end_time)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    type="button"
                    onClick={() => navigate("/attendance")}
                  >
                    Attendance
                  </Button>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center">
                <CalendarDays size={22} className="mx-auto text-slate-300" />
                <p className="mt-2 text-sm font-medium text-slate-700">No classes scheduled today</p>
                <p className="mt-1 text-xs text-slate-400">Your timetable does not contain a lesson for today.</p>
              </div>
            )}
          </div>
        </Card>

        <Card className="min-w-0 p-4 sm:p-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">My teaching assignments</h2>
            <p className="mt-1 text-sm text-slate-500">Classes and subjects assigned to you.</p>
          </div>

          <div className="mt-5 space-y-3">
            {loading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
                <Loader2 size={16} className="animate-spin" />
                Loading assignments...
              </div>
            ) : selectedSectionAssignments.length > 0 ? (
              selectedSectionAssignments.slice(0, 6).map((assignment) => (
                <div key={assignment.id} className="rounded-lg border border-slate-200 p-3">
                  <p className="text-sm font-medium text-slate-900">{assignment.className}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {assignment.subjectName} • {assignment.sectionName}
                  </p>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                No teaching assignments found.
              </div>
            )}
          </div>
        </Card>
      </div>

      )}

      {!isEarlyYears && (
      <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-2">
        <Card className="min-w-0 p-4 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900">Attendance today</h2>
              <p className="mt-1 text-sm text-slate-500">Attendance recorded for your assigned classes.</p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <ClipboardCheck size={20} />
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-4xl font-semibold tracking-tight text-slate-900">
                {loading ? "—" : `${selectedAttendanceRate.toFixed(1)}%`}
              </div>
              <p className="mt-1 text-sm text-slate-500">{loading ? "Loading..." : attendanceLabel}</p>
            </div>
            <Button size="sm" type="button" onClick={() => navigate("/attendance")}>
              Open attendance
            </Button>
          </div>

          <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-indigo-600 transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, selectedAttendanceRate))}%` }}
            />
          </div>
        </Card>

        <Card className="min-w-0 p-4 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900">Recent assessments</h2>
              <p className="mt-1 text-sm text-slate-500">Assessments linked to your classes and subjects.</p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
              <BookOpen size={20} />
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {loading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
                <Loader2 size={16} className="animate-spin" />
                Loading assessments...
              </div>
            ) : selectedSectionAssessments.length > 0 ? (
              selectedSectionAssessments.slice(0, 4).map((assessment) => (
                <div key={assessment.id} className="flex min-w-0 items-center gap-3 rounded-lg border border-slate-200 p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                    <BookOpen size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{assessment.title}</p>
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {assessment.subjectName} • {assessment.className}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] font-medium text-slate-400">
                    {formatDate(assessment.assessment_date)}
                  </span>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                No assessments found for your current assignments.
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => navigate("/assessments")}
            className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            Open assessments
            <ArrowUpRight size={14} />
          </button>
        </Card>
      </div>

      )}

      <div className="mt-6 grid min-w-0 gap-6 xl:grid-cols-3">
        {!isEarlyYears && (
        <Card className="min-w-0 p-4 sm:p-6 xl:col-span-2">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900">Upcoming timetable</h2>
              <p className="mt-1 text-sm text-slate-500">Other lessons from your current timetable.</p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <CalendarDays size={20} />
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {upcomingLessons.length > 0 ? (
              upcomingLessons.map((lesson) => (
                <div key={lesson.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-indigo-600">{lesson.day_of_week}</p>
                    <p className="text-[11px] text-slate-400">
                      {formatTime(lesson.start_time)} – {formatTime(lesson.end_time)}
                    </p>
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-900">{lesson.subjectName}</p>
                  <p className="mt-1 text-xs text-slate-500">{lesson.className}</p>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500 sm:col-span-2">
                No additional lessons found.
              </div>
            )}
          </div>
        </Card>
        )}

        <Card className="min-w-0 p-4 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900">School announcements</h2>
              <p className="mt-1 text-sm text-slate-500">Latest messages from the school.</p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fuchsia-100 text-fuchsia-700">
              <Megaphone size={20} />
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {announcements.length > 0 ? (
              announcements.map((announcement) => (
                <div key={announcement.id} className="min-w-0 border-b border-slate-100 pb-4 last:border-0 last:pb-0">
                  <p className="break-words text-sm font-medium text-slate-900">
                    {announcement.title || "School announcement"}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">{formatRelativeTime(announcement.created_at)}</p>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                No announcements yet.
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => navigate("/announcements")}
            className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            View announcements
            <ArrowUpRight size={14} />
          </button>
        </Card>
      </div>

      <Card className="mt-6 min-w-0 p-4 sm:p-6">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Quick actions</h2>
          <p className="mt-1 text-sm text-slate-500">Common tasks for your teaching workflow.</p>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
          <Button type="button" size="sm" onClick={() => navigate("/attendance")}>
            <ClipboardCheck size={15} />
            Take attendance
          </Button>
          {!isEarlyYears && (
            <>
              <Button type="button" size="sm" variant="secondary" onClick={() => navigate("/assessments")}>
                <BookOpen size={15} />
                Manage assessments
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => navigate("/student-results")}>
                <GraduationCap size={15} />
                Student results
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => navigate("/timetable")}>
                <CalendarDays size={15} />
                View timetable
              </Button>
            </>
          )}
        </div>
      </Card>

      {careChild && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Daily care record</p>
                <h2 className="mt-1 truncate text-lg font-semibold text-slate-900">{careChild.name}</h2>
                <p className="mt-1 text-xs text-slate-500">{careChild.studentId} • {careChild.className}</p>
              </div>
              <button
                type="button"
                onClick={() => setCareChild(null)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close daily care record"
              >
                <X size={18} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
              {careLoading ? (
                <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-500">
                  <Loader2 size={17} className="animate-spin" />
                  Loading today's care record...
                </div>
              ) : (
                <div className="space-y-6">
                  {careError && (
                    <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                      {careError}
                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-700">Record date</label>
                      <input
                        type="date"
                        value={careDate}
                        disabled
                        className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600 outline-none"
                      />
                    </div>
                    <CareSelect
                      label="Mood"
                      value={careForm.mood}
                      onChange={(value) => setCareForm((current) => ({ ...current, mood: value }))}
                      options={["Happy", "Calm", "Active", "Tired", "Sad", "Unwell"]}
                      placeholder="Select mood"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">Wellbeing</label>
                    <textarea
                      value={careForm.wellbeing}
                      onChange={(event) => setCareForm((current) => ({ ...current, wellbeing: event.target.value }))}
                      rows={2}
                      placeholder="How is the child doing today?"
                      className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>

                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-orange-700">
                        <Utensils size={17} />
                      </div>
                      <h3 className="text-sm font-semibold text-slate-900">Meals & feeding</h3>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <CareCheckbox label="Breakfast" checked={careForm.breakfast} onChange={(value) => setCareForm((current) => ({ ...current, breakfast: value }))} />
                      <CareCheckbox label="Morning snack" checked={careForm.morningSnack} onChange={(value) => setCareForm((current) => ({ ...current, morningSnack: value }))} />
                      <CareCheckbox label="Lunch" checked={careForm.lunch} onChange={(value) => setCareForm((current) => ({ ...current, lunch: value }))} />
                    </div>
                    <textarea
                      value={careForm.feedingNotes}
                      onChange={(event) => setCareForm((current) => ({ ...current, feedingNotes: event.target.value }))}
                      rows={2}
                      placeholder="Feeding notes, appetite or special instructions..."
                      className="mt-3 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>

                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                        <Moon size={17} />
                      </div>
                      <h3 className="text-sm font-semibold text-slate-900">Nap & rest</h3>
                    </div>
                    <div className="mt-4 grid gap-4 sm:grid-cols-3">
                      <CareSelect label="Nap start" value={careForm.napStart} onChange={(value) => setCareForm((current) => ({ ...current, napStart: value }))} type="time" />
                      <CareSelect label="Nap end" value={careForm.napEnd} onChange={(value) => setCareForm((current) => ({ ...current, napEnd: value }))} type="time" />
                      <CareSelect label="Nap quality" value={careForm.napQuality} onChange={(value) => setCareForm((current) => ({ ...current, napQuality: value }))} options={["Good", "Restless", "Short", "Did not sleep"]} placeholder="Select quality" />
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <CareTextArea label="Daily observation" value={careForm.observation} onChange={(value) => setCareForm((current) => ({ ...current, observation: value }))} placeholder="What did you observe today?" />
                    <CareTextArea label="Activities" value={careForm.activityNotes} onChange={(value) => setCareForm((current) => ({ ...current, activityNotes: value }))} placeholder="Activities and participation..." />
                    <CareTextArea label="Hygiene / personal care" value={careForm.hygieneNotes} onChange={(value) => setCareForm((current) => ({ ...current, hygieneNotes: value }))} placeholder="Relevant hygiene or personal-care notes..." />
                    <CareTextArea label="Incident / health notes" value={careForm.incidentNotes} onChange={(value) => setCareForm((current) => ({ ...current, incidentNotes: value }))} placeholder="Record any incident, illness or health concern..." />
                  </div>

                  <CareTextArea label="Teacher notes" value={careForm.teacherNotes} onChange={(value) => setCareForm((current) => ({ ...current, teacherNotes: value }))} placeholder="Additional notes for the child's record or parent follow-up..." />
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
              <Button type="button" variant="secondary" onClick={() => setCareChild(null)}>Cancel</Button>
              <Button type="button" onClick={() => void saveCareRecord()} disabled={careLoading || careSaving}>
                {careSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {careSaving ? "Saving..." : "Save daily care"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CareSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options?: string[];
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-700">{label}</label>
      {options ? (
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        >
          <option value="">{placeholder ?? "Select"}</option>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : (
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
      )}
    </div>
  );
}

function CareCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
      {label}
    </label>
  );
}

function CareTextArea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-700">{label}</label>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        placeholder={placeholder}
        className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
      />
    </div>
  );
}
