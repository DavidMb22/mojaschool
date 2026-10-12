import { useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronRight,
  Edit3,
  Plus,
  Search,
  Users,
  X,
} from "lucide-react";

import { supabase } from "../lib/supabase";
import { useSchool } from "../context/SchoolContext";
import { normalizeRole } from "../lib/permissions";

import Card from "../components/ui/Card";
import Button from "../components/ui/Button";

interface SchoolClass {
  id: string;
  name: string;
  section: string | null;
  academic_year_id: string | null;
  academic_section_id: string | null;
  capacity: number | null;
  is_active: boolean;
  class_teacher_id: string | null;
}

interface AcademicSection {
  id: string;
  school_id: string;
  academic_year_id: string;
  name: string;
  display_order: number;
  is_active: boolean;
}

interface AcademicYear {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
}

interface Subject {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  is_active: boolean;
}

interface ClassSubject {
  id: string;
  class_id: string;
  subject_id: string;
}

interface TeacherOption {
  id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  email: string | null;
  signature_path: string | null;
}

function teacherDisplayName(teacher: TeacherOption): string {
  return [teacher.first_name, teacher.middle_name, teacher.last_name]
    .filter(Boolean)
    .join(" ");
}

type Tab = "classes" | "subjects";

export default function ClassesSubjects() {
  const { school, membership } = useSchool();
  const navigate = useNavigate();
  const role = normalizeRole(membership?.role);
  const isTeacher = role === "Teacher";
  const [searchParams] = useSearchParams();
  const academicYearFromUrl = searchParams.get("academicYear");

  const [activeTab, setActiveTab] = useState<Tab>("classes");

  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [teacherClassIds, setTeacherClassIds] = useState<string[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);

  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);

  const [academicSections, setAcademicSections] = useState<AcademicSection[]>([]);

  const [selectedAcademicYearId, setSelectedAcademicYearId] = useState("");

  const [subjects, setSubjects] = useState<Subject[]>([]);

  const [classSubjects, setClassSubjects] = useState<ClassSubject[]>([]);

  const [enrollmentCounts, setEnrollmentCounts] = useState<Record<string, number>>({});

  const [loading, setLoading] = useState(true);

  const [pageError, setError] = useState("");

  const [search, setSearch] = useState("");

  const [showClassModal, setShowClassModal] = useState(false);

  const [showSubjectModal, setShowSubjectModal] = useState(false);

  const [editingClass, setEditingClass] = useState<SchoolClass | null>(null);

  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);

  const [selectedClass, setSelectedClass] = useState<SchoolClass | null>(null);

  const [showSubjectsModal, setShowSubjectsModal] = useState(false);

  const [classStatusFilter, setClassStatusFilter] = useState<
    "active" | "inactive" | "all"
  >("active");

  async function loadData() {
    if (!school) {
      setClasses([]);
      setTeacherClassIds([]);
      setTeachers([]);
      setAcademicYears([]);
      setAcademicSections([]);
      setSubjects([]);
      setClassSubjects([]);
      setEnrollmentCounts({});
      setSelectedAcademicYearId("");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    /*
     * Teachers must only receive the classes they are assigned to.
     * We resolve the logged-in teacher first, then use the assignment
     * records to scope the academic data loaded by this page.
     */
    let assignedClassIds: string[] = [];
    let assignedYearIds: string[] = [];

    if (isTeacher) {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        setError(userError.message);
        setClasses([]);
        setTeacherClassIds([]);
          setAcademicYears([]);
        setAcademicSections([]);
        setSubjects([]);
        setClassSubjects([]);
        setEnrollmentCounts({});
        setSelectedAcademicYearId("");
        setLoading(false);
        return;
      }

      if (!user?.email) {
        setError("Your teacher account could not be identified.");
        setClasses([]);
        setTeacherClassIds([]);
          setLoading(false);
        return;
      }

      const { data: teacherData, error: teacherError } = await supabase
        .from("teachers")
        .select("id")
        .eq("school_id", school.id)
        .ilike("email", user.email)
        .maybeSingle();

      if (teacherError) {
        setError(teacherError.message);
        setClasses([]);
        setTeacherClassIds([]);
          setLoading(false);
        return;
      }

      if (!teacherData?.id) {
        setError(
          "No teacher record is linked to your school account. Please ask a school administrator to match your school email with your teacher profile.",
        );
        setClasses([]);
        setTeacherClassIds([]);
          setAcademicYears([]);
        setAcademicSections([]);
        setSubjects([]);
        setClassSubjects([]);
        setEnrollmentCounts({});
        setSelectedAcademicYearId("");
        setLoading(false);
        return;
      }

      const { data: assignmentsData, error: assignmentError } =
        await supabase
          .from("teacher_assignments")
          .select("class_id, academic_year_id")
          .eq("school_id", school.id)
          .eq("teacher_id", teacherData.id);

      if (assignmentError) {
        setError(assignmentError.message);
        setClasses([]);
        setTeacherClassIds([]);
          setLoading(false);
        return;
      }

      assignedClassIds = Array.from(
        new Set(
          (assignmentsData ?? [])
            .map((item) => item.class_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );

      assignedYearIds = Array.from(
        new Set(
          (assignmentsData ?? [])
            .map((item) => item.academic_year_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );

      setTeacherClassIds(assignedClassIds);
    } else {
      setTeacherClassIds([]);
      setTeachers([]);
    }

    /*
     * Admins can see the full academic structure.
     * Teachers only load their assigned classes and the class subjects
     * belonging to those classes.
     */
    const classesQuery = supabase
      .from("classes")
      .select(
        `
        id,
        name,
        section,
        academic_year_id,
        academic_section_id,
        capacity,
        is_active,
        class_teacher_id
      `,
      )
      .eq("school_id", school.id)
      .order("name");

    const classSubjectsQuery = supabase
      .from("class_subjects")
      .select(
        `
        id,
        class_id,
        subject_id
      `,
      )
      .eq("school_id", school.id);

    const enrollmentsQuery = supabase
      .from("enrollments")
      .select("class_id, academic_year_id, status")
      .eq("school_id", school.id);

    if (isTeacher) {
      if (assignedClassIds.length === 0) {
        setClasses([]);
        setAcademicYears([]);
        setAcademicSections([]);
        setSubjects([]);
        setClassSubjects([]);
        setEnrollmentCounts({});
        setSelectedAcademicYearId("");
        setLoading(false);
        return;
      }

      classesQuery.in("id", assignedClassIds);
      classSubjectsQuery.in("class_id", assignedClassIds);
      enrollmentsQuery.in("class_id", assignedClassIds);
    }

    const [
      academicYearsResult,
      academicSectionsResult,
      classesResult,
      subjectsResult,
      classSubjectsResult,
      enrollmentsResult,
    ] = await Promise.all([
      supabase
        .from("academic_years")
        .select(
          `
          id,
          name,
          start_date,
          end_date,
          is_active
        `,
        )
        .eq("school_id", school.id)
        .order("name", { ascending: false }),

      supabase
        .from("academic_sections")
        .select(
          `
          id,
          school_id,
          academic_year_id,
          name,
          display_order,
          is_active
        `,
        )
        .eq("school_id", school.id)
        .order("display_order", { ascending: true }),

      classesQuery,

      supabase
        .from("subjects")
        .select(
          `
          id,
          name,
          code,
          description,
          is_active
        `,
        )
        .eq("school_id", school.id)
        .order("name"),

      classSubjectsQuery,

      enrollmentsQuery,
    ]);

    if (academicYearsResult.error) {
      setError(academicYearsResult.error.message);
      setLoading(false);
      return;
    }

    if (academicSectionsResult.error) {
      setError(academicSectionsResult.error.message);
      setLoading(false);
      return;
    }

    if (classesResult.error) {
      setError(classesResult.error.message);
      setLoading(false);
      return;
    }

    if (subjectsResult.error) {
      setError(subjectsResult.error.message);
      setLoading(false);
      return;
    }

    if (classSubjectsResult.error) {
      setError(classSubjectsResult.error.message);
      setLoading(false);
      return;
    }

    if (enrollmentsResult.error) {
      setError(enrollmentsResult.error.message);
      setLoading(false);
      return;
    }

    let loadedTeacherOptions: TeacherOption[] = [];
    if (!isTeacher) {
      const { data: teacherData, error: teacherError } = await supabase
        .from("teachers")
        .select("id, first_name, middle_name, last_name, email, signature_path")
        .eq("school_id", school.id)
        .order("first_name", { ascending: true });

      if (teacherError) {
        console.error("Unable to load class-teacher options:", teacherError);
        setError(`Classes loaded, but the class-teacher list could not be loaded: ${teacherError.message}`);
      } else {
        loadedTeacherOptions = (teacherData ?? []) as TeacherOption[];
      }
    }
    setTeachers(loadedTeacherOptions);

    const loadedAcademicYears = (academicYearsResult.data ?? []).filter(
      (year) => !isTeacher || assignedYearIds.includes(year.id),
    );

    const loadedClasses = (classesResult.data ?? []).filter(
      (schoolClass) =>
        !isTeacher || assignedClassIds.includes(schoolClass.id),
    );

    const loadedClassSubjects = (classSubjectsResult.data ?? []).filter(
      (item) =>
        !isTeacher || assignedClassIds.includes(item.class_id),
    );

    const loadedEnrollments = (enrollmentsResult.data ?? []).filter(
      (enrollment) =>
        !isTeacher || assignedClassIds.includes(enrollment.class_id),
    );

    const assignedSubjectIds = new Set(
      loadedClassSubjects.map((item) => item.subject_id),
    );

    const loadedSubjects = (subjectsResult.data ?? []).filter(
      (subject) => !isTeacher || assignedSubjectIds.has(subject.id),
    );

    const loadedSections = (academicSectionsResult.data ?? []).filter(
      (section) =>
        !isTeacher ||
        loadedClasses.some(
          (schoolClass) =>
            schoolClass.academic_section_id === section.id,
        ),
    );

    setAcademicYears(loadedAcademicYears);
    setAcademicSections(loadedSections);
    setClasses(loadedClasses);
    setSubjects(loadedSubjects);
    setClassSubjects(loadedClassSubjects);

    const counts: Record<string, number> = {};
    loadedEnrollments.forEach((enrollment) => {
      if (
        enrollment.status !== "Active" ||
        !enrollment.class_id ||
        !enrollment.academic_year_id
      ) {
        return;
      }

      const schoolClass = loadedClasses.find(
        (item) => item.id === enrollment.class_id,
      );

      if (
        schoolClass?.academic_year_id === enrollment.academic_year_id
      ) {
        counts[enrollment.class_id] =
          (counts[enrollment.class_id] ?? 0) + 1;
      }
    });
    setEnrollmentCounts(counts);

    setSelectedAcademicYearId((current) => {
      if (
        academicYearFromUrl &&
        loadedAcademicYears.some((year) => year.id === academicYearFromUrl)
      ) {
        return academicYearFromUrl;
      }

      if (current && loadedAcademicYears.some((year) => year.id === current)) {
        return current;
      }

      const activeYear = loadedAcademicYears.find((year) => year.is_active);

      return activeYear?.id ?? loadedAcademicYears[0]?.id ?? "";
    });

    setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, [school, academicYearFromUrl, isTeacher]);

  const filteredClasses = useMemo(() => {
    const query = search.toLowerCase().trim();

    let yearClasses = selectedAcademicYearId
      ? classes.filter(
          (item) => item.academic_year_id === selectedAcademicYearId,
        )
      : classes;

    if (isTeacher) {
      yearClasses = yearClasses.filter((item) =>
        teacherClassIds.includes(item.id),
      );
    }

    if (classStatusFilter === "active") {
      yearClasses = yearClasses.filter((item) => item.is_active);
    }

    if (classStatusFilter === "inactive") {
      yearClasses = yearClasses.filter((item) => !item.is_active);
    }

    if (!query) return yearClasses;

    return yearClasses.filter((item) =>
      [
        item.name,
        item.section ?? "",
        academicYears.find((year) => year.id === item.academic_year_id)?.name ??
          "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [
    classes,
    search,
    selectedAcademicYearId,
    academicYears,
    classStatusFilter,
    isTeacher,
    teacherClassIds,
  ]);

  const filteredSubjects = useMemo(() => {
    const query = search.toLowerCase().trim();

    if (!query) return subjects;

    return subjects.filter((item) =>
      [item.name, item.code ?? "", item.description ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [subjects, search]);

  const classTeacherNames = useMemo(
    () => Object.fromEntries(teachers.map((teacher) => [teacher.id, teacherDisplayName(teacher)])),
    [teachers],
  );

  function openCreateClass() {
    if (isTeacher) return;
    setEditingClass(null);
    setShowClassModal(true);
    setError("");
  }

  function openEditClass(schoolClass: SchoolClass) {
    if (isTeacher) return;
    setEditingClass(schoolClass);
    setShowClassModal(true);
    setError("");
  }

  function openCreateSubject() {
    if (isTeacher) return;
    setEditingSubject(null);
    setShowSubjectModal(true);
    setError("");
  }

  function openEditSubject(subject: Subject) {
    if (isTeacher) return;
    setEditingSubject(subject);
    setShowSubjectModal(true);
    setError("");
  }

  function openClassSubjects(schoolClass: SchoolClass) {
    if (isTeacher) return;
    setSelectedClass(schoolClass);
    setShowSubjectsModal(true);
    setError("");
  }

  async function toggleClassStatus(schoolClass: SchoolClass) {
    if (isTeacher) return;
    setError("");

    const { error: updateError } = await supabase
      .from("classes")
      .update({
        is_active: !schoolClass.is_active,
      })
      .eq("id", schoolClass.id)
      .eq("school_id", school?.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setClasses((current) =>
      current.map((item) =>
        item.id === schoolClass.id
          ? {
              ...item,
              is_active: !item.is_active,
            }
          : item,
      ),
    );
  }

  async function toggleSubjectStatus(subject: Subject) {
    if (isTeacher) return;
    setError("");

    const { error: updateError } = await supabase
      .from("subjects")
      .update({
        is_active: !subject.is_active,
      })
      .eq("id", subject.id)
      .eq("school_id", school?.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSubjects((current) =>
      current.map((item) =>
        item.id === subject.id
          ? {
              ...item,
              is_active: !item.is_active,
            }
          : item,
      ),
    );
  }

  function getSubjectCount(classId: string) {
    return classSubjects.filter((item) => item.class_id === classId).length;
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      {/* Header */}
      <div className="mb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <BookOpen size={20} className="text-indigo-600" />
              <h1 className="text-xl font-semibold text-slate-900">
                {isTeacher ? "My Classes & Subjects" : "Classes & Subjects"}
              </h1>
            </div>

            <p className="mt-1 text-sm text-slate-500">
              {isTeacher
                ? "View classes and subjects relevant to your teaching responsibilities."
                : "Manage classes and subjects for the selected academic year."}
            </p>
          </div>

          {!isTeacher && activeTab === "classes" && academicYears.length > 0 && (
            <button
              type="button"
              onClick={openCreateClass}
              disabled={!selectedAcademicYearId}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Plus size={16} />
              Add class
            </button>
          )}

          {!isTeacher && activeTab === "subjects" && (
            <button
              type="button"
              onClick={openCreateSubject}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700"
            >
              <Plus size={16} />
              Add subject
            </button>
          )}
        </div>
      </div>

      {pageError && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {pageError}
        </div>
      )}

      {isTeacher && (
        <div className="mb-5 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
          <p className="text-sm font-medium text-indigo-900">Teaching view</p>
          <p className="mt-1 text-xs leading-5 text-indigo-700">
            You can only view classes and subjects assigned to you. Class,
            section, subject, and curriculum management is handled by school
            administrators.
          </p>
        </div>
      )}

      {/* Current academic year */}
      {academicYears.length > 0 && (
        <Card className="mb-6">
          <div className="p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Current academic year
                  </p>

                  {academicYears.find(
                    (year) => year.id === selectedAcademicYearId,
                  )?.is_active && (
                    <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">
                      Active
                    </span>
                  )}
                </div>

                <h2 className="mt-1 text-lg font-semibold text-slate-900">
                  {academicYears.find(
                    (year) => year.id === selectedAcademicYearId,
                  )?.name ?? "No academic year selected"}
                </h2>

                {(() => {
                  const selectedYear = academicYears.find(
                    (year) => year.id === selectedAcademicYearId,
                  );

                  return (
                    <p className="mt-1 text-sm text-slate-500">
                      {selectedYear?.start_date
                        ? new Intl.DateTimeFormat("en-GB", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          }).format(new Date(selectedYear.start_date))
                        : "Start date not set"}
                      <span className="mx-2 text-slate-300">•</span>
                      {selectedYear?.end_date
                        ? new Intl.DateTimeFormat("en-GB", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          }).format(new Date(selectedYear.end_date))
                        : "End date not set"}
                    </p>
                  );
                })()}

                <p className="mt-2 text-xs text-slate-400">
                  Classes and subject assignments are managed separately for
                  each academic year.
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <select
                  value={selectedAcademicYearId}
                  onChange={(event) =>
                    setSelectedAcademicYearId(event.target.value)
                  }
                  className="h-10 min-w-[220px] rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                >
                  {academicYears.map((year) => (
                    <option key={year.id} value={year.id}>
                      {year.name}
                      {year.is_active ? " • Active" : ""}
                    </option>
                  ))}
                </select>

                {!isTeacher && (
                  <button
                    type="button"
                    onClick={() => navigate("/settings/academic")}
                    className="h-10 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                >
                    Manage academic years
                  </button>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      {academicYears.length === 0 && (
        <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4">
          {isTeacher ? (
            <div>
              <p className="text-sm font-semibold text-slate-800">
                No academic year available yet
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Please wait until the Head of Academics adds an academic year
                for your school. Your classes and subjects will appear here
                once they are assigned to you.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  Set up an academic year first
                </p>
                <p className="mt-1 text-sm text-amber-700">
                  Create an academic year before adding classes or assigning
                  curriculum.
                </p>
              </div>

              <button
                type="button"
                onClick={() => navigate("/settings/academic")}
                className="inline-flex h-9 items-center justify-center rounded-lg bg-amber-600 px-3 text-sm font-medium text-white hover:bg-amber-700"
              >
                Create academic year
              </button>
            </div>
          )}
        </div>
      )}

      {/* Sections for selected academic year */}
      {academicYears.length > 0 && selectedAcademicYearId && (
        <Card className="mb-5">
          <div className="p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Sections
                </p>
                <h3 className="mt-1 text-base font-semibold text-slate-900">
                  Sections for this academic year
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Classes are created under these sections. Configure sections
                  in Academic Settings before adding classes.
                </p>
              </div>

              {!isTeacher && (
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/settings/academic?academicYear=${selectedAcademicYearId}`,
                    )
                  }
                  className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Manage sections
                </button>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {academicSections
                .filter(
                  (section) =>
                    section.academic_year_id === selectedAcademicYearId &&
                    section.is_active,
                )
                .map((section) => (
                  <span
                    key={section.id}
                    className="rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700"
                  >
                    {section.name}
                  </span>
                ))}

              {academicSections.filter(
                (section) =>
                  section.academic_year_id === selectedAcademicYearId &&
                  section.is_active,
              ).length === 0 && (
                <span className="text-sm text-amber-600">
                  No active sections configured yet.
                </span>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Tabs + Search */}
      <Card className="mb-5">
        <div className="flex flex-col border-b border-slate-200 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-6 px-5 pt-4">
            <button
              type="button"
              onClick={() => {
                setActiveTab("classes");
                setSearch("");
              }}
              className={[
                "relative pb-3 text-sm font-medium",
                activeTab === "classes"
                  ? "text-indigo-600"
                  : "text-slate-500 hover:text-slate-800",
              ].join(" ")}
            >
              Classes
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px]">
                {filteredClasses.length}
              </span>
              {activeTab === "classes" && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-indigo-600" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab("subjects");
                setSearch("");
              }}
              className={[
                "relative pb-3 text-sm font-medium",
                activeTab === "subjects"
                  ? "text-indigo-600"
                  : "text-slate-500 hover:text-slate-800",
              ].join(" ")}
            >
              Subjects
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px]">
                {subjects.length}
              </span>
              {activeTab === "subjects" && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-indigo-600" />
              )}
            </button>
          </div>

          <div className="flex w-full flex-col gap-2 px-5 pb-3 pt-3 sm:w-auto sm:flex-row sm:items-center sm:pb-2 sm:pt-0">
            <div className="relative sm:w-72">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={
                  activeTab === "classes"
                    ? "Search classes..."
                    : "Search subjects..."
                }
                className="h-9 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            {activeTab === "classes" && (
              <select
                value={classStatusFilter}
                onChange={(event) =>
                  setClassStatusFilter(
                    event.target.value as "active" | "inactive" | "all",
                  )
                }
                className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="active">Active classes</option>
                <option value="inactive">Inactive classes</option>
                <option value="all">All classes</option>
              </select>
            )}
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="p-12 text-center text-sm text-slate-500">
            Loading...
          </div>
        ) : activeTab === "classes" ? (
          <ClassesTable
            classes={filteredClasses}
            getSubjectCount={getSubjectCount}
            enrollmentCounts={enrollmentCounts}
            academicYears={academicYears}
            academicSections={academicSections}
            classTeacherNames={classTeacherNames}
            onEdit={openEditClass}
            onToggle={toggleClassStatus}
            onSubjects={openClassSubjects}
            onCreate={openCreateClass}
            canManage={!isTeacher}
          />
        ) : (
          <SubjectsTable
            subjects={filteredSubjects}
            onEdit={openEditSubject}
            onToggle={toggleSubjectStatus}
            onCreate={openCreateSubject}
            canManage={!isTeacher}
          />
        )}
      </Card>

      {/* Class modal */}
      {!isTeacher && showClassModal && (
        <ClassModal
          schoolId={school?.id ?? ""}
          academicYears={academicYears}
          academicSections={academicSections}
          teachers={teachers}
          selectedAcademicYearId={selectedAcademicYearId}
          editingClass={editingClass}
          onClose={() => setShowClassModal(false)}
          onSaved={() => {
            setShowClassModal(false);
            loadData();
          }}
        />
      )}

      {/* Subject modal */}
      {!isTeacher && showSubjectModal && (
        <SubjectModal
          schoolId={school?.id ?? ""}
          editingSubject={editingSubject}
          onClose={() => setShowSubjectModal(false)}
          onSaved={() => {
            setShowSubjectModal(false);
            loadData();
          }}
        />
      )}

      {/* Assign subjects modal */}
      {!isTeacher && showSubjectsModal && selectedClass && (
        <ClassSubjectsModal
          schoolId={school?.id ?? ""}
          schoolClass={selectedClass}
          subjects={subjects}
          classSubjects={classSubjects}
          onClose={() => {
            setShowSubjectsModal(false);
            setSelectedClass(null);
          }}
          onSaved={() => {
            setShowSubjectsModal(false);
            setSelectedClass(null);
            loadData();
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Classes table                                                               */
/* -------------------------------------------------------------------------- */

function ClassesTable({
  classes,
  getSubjectCount,
  enrollmentCounts,
  academicYears,
  academicSections,
  classTeacherNames,
  onEdit,
  onToggle,
  onSubjects,
  onCreate,
  canManage,
}: {
  classes: SchoolClass[];
  getSubjectCount: (classId: string) => number;
  enrollmentCounts: Record<string, number>;
  academicYears: AcademicYear[];
  academicSections: AcademicSection[];
  classTeacherNames: Record<string, string>;
  onEdit: (schoolClass: SchoolClass) => void;
  onToggle: (schoolClass: SchoolClass) => void;
  onSubjects: (schoolClass: SchoolClass) => void;
  onCreate: () => void;
  canManage: boolean;
}) {
  if (classes.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No classes yet"
        description="Create a class for this academic year to start organizing your students and curriculum."
        action={canManage ? "Add class" : undefined}
        onAction={canManage ? onCreate : undefined}
        showAction={canManage}
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px]">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/70">
            <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Class
            </th>

            <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Class teacher
            </th>

            <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Academic year
            </th>

            <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Students
            </th>

            <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Capacity
            </th>

            <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Subjects
            </th>

            <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Status
            </th>

            <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Actions
            </th>
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-100">
          {classes.map((schoolClass) => (
            <tr key={schoolClass.id} className="hover:bg-slate-50">
              <td className="px-5 py-4">
                <div className="text-sm font-medium text-slate-900">
                  {schoolClass.name}
                </div>

                {(() => {
                  const sectionName =
                    academicSections.find(
                      (item) =>
                        item.id === schoolClass.academic_section_id,
                    )?.name || schoolClass.section;

                  return sectionName ? (
                    <div className="mt-1 text-xs text-slate-500">
                      {sectionName}
                    </div>
                  ) : null;
                })()}
              </td>

              <td className="px-5 py-4 text-sm text-slate-600">
                {schoolClass.class_teacher_id
                  ? classTeacherNames[schoolClass.class_teacher_id] || "Assigned teacher"
                  : "Not assigned"}
              </td>

              <td className="px-5 py-4 text-sm text-slate-600">
                {academicYears.find(
                  (year) => year.id === schoolClass.academic_year_id,
                )?.name || "—"}
              </td>

              <td className="px-5 py-4 text-sm text-slate-600">
                {enrollmentCounts[schoolClass.id] ?? 0}
              </td>

              <td className="px-5 py-4 text-sm text-slate-600">
                {schoolClass.capacity ?? "—"}
              </td>

              <td className="px-5 py-4">
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => onSubjects(schoolClass)}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
                  >
                    {getSubjectCount(schoolClass.id)} assigned
                    <ChevronRight size={13} />
                  </button>
                ) : (
                  <span className="text-sm text-slate-600">
                    {getSubjectCount(schoolClass.id)} assigned
                  </span>
                )}
              </td>

              <td className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => onToggle(schoolClass)}
                      className={[
                        "rounded-full px-2.5 py-1 text-[11px] font-medium",
                        schoolClass.is_active
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-500",
                      ].join(" ")}
                    >
                      {schoolClass.is_active ? "Active" : "Inactive"}
                    </button>
                  ) : (
                    <span
                      className={[
                        "rounded-full px-2.5 py-1 text-[11px] font-medium",
                        schoolClass.is_active
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-500",
                      ].join(" ")}
                    >
                      {schoolClass.is_active ? "Active" : "Inactive"}
                    </span>
                  )}

                  {schoolClass.capacity !== null &&
                    (enrollmentCounts[schoolClass.id] ?? 0) >=
                      schoolClass.capacity && (
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                        Full
                      </span>
                    )}
                </div>
              </td>

              <td className="px-5 py-4 text-right">
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => onEdit(schoolClass)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <Edit3 size={15} />
                  </button>
                ) : (
                  <span className="text-xs text-slate-400">View only</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Subjects table                                                              */
/* -------------------------------------------------------------------------- */

function SubjectsTable({
  subjects,
  onEdit,
  onToggle,
  onCreate,
  canManage,
}: {
  subjects: Subject[];
  onEdit: (subject: Subject) => void;
  onToggle: (subject: Subject) => void;
  onCreate: () => void;
  canManage: boolean;
}) {
  if (subjects.length === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        title="No subjects yet"
        description="Create subjects that can be assigned to your classes."
        action={canManage ? "Add subject" : undefined}
        onAction={canManage ? onCreate : undefined}
        showAction={canManage}
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[700px]">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/70">
            <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Subject
            </th>

            <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Code
            </th>

            <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Description
            </th>

            <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Status
            </th>

            <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Actions
            </th>
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-100">
          {subjects.map((subject) => (
            <tr key={subject.id} className="hover:bg-slate-50">
              <td className="px-5 py-4">
                <div className="text-sm font-medium text-slate-900">
                  {subject.name}
                </div>
              </td>

              <td className="px-5 py-4 text-sm text-slate-600">
                {subject.code || "—"}
              </td>

              <td className="max-w-md px-5 py-4 text-sm text-slate-500">
                <div className="truncate">
                  {subject.description || "No description"}
                </div>
              </td>

              <td className="px-5 py-4">
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => onToggle(subject)}
                    className={[
                      "rounded-full px-2.5 py-1 text-[11px] font-medium",
                      subject.is_active
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-100 text-slate-500",
                    ].join(" ")}
                  >
                    {subject.is_active ? "Active" : "Inactive"}
                  </button>
                ) : (
                  <span
                    className={[
                      "rounded-full px-2.5 py-1 text-[11px] font-medium",
                      subject.is_active
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-100 text-slate-500",
                    ].join(" ")}
                  >
                    {subject.is_active ? "Active" : "Inactive"}
                  </span>
                )}
              </td>

              <td className="px-5 py-4 text-right">
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => onEdit(subject)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <Edit3 size={15} />
                  </button>
                ) : (
                  <span className="text-xs text-slate-400">View only</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Class modal                                                                 */
/* -------------------------------------------------------------------------- */

function ClassModal({
  schoolId,
  academicYears,
  academicSections,
  teachers,
  selectedAcademicYearId,
  editingClass,
  onClose,
  onSaved,
}: {
  schoolId: string;
  academicYears: AcademicYear[];
  academicSections: AcademicSection[];
  teachers: TeacherOption[];
  selectedAcademicYearId: string;
  editingClass: SchoolClass | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(editingClass?.name ?? "");

  const [academicSectionId, setAcademicSectionId] = useState(
    editingClass?.academic_section_id ?? "",
  );

  const [academicYearId, setAcademicYearId] = useState(
    editingClass?.academic_year_id ??
      selectedAcademicYearId ??
      academicYears.find((year) => year.is_active)?.id ??
      academicYears[0]?.id ??
      "",
  );

  const [capacity, setCapacity] = useState(
    editingClass?.capacity?.toString() ?? "",
  );

  const [classTeacherId, setClassTeacherId] = useState(
    editingClass?.class_teacher_id ?? "",
  );
  const [signatureFile, setSignatureFile] = useState<File | null>(null);

  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!name.trim()) {
      setError("Class name is required.");
      return;
    }

    if (!academicYearId) {
      setError("Academic year is required.");
      return;
    }

    if (!academicSectionId) {
      setError("Please select a section.");
      return;
    }

    if (!capacity) {
      setError("Capacity is required.");
      return;
    }

    const numericCapacity = Number(capacity);

    if (!Number.isInteger(numericCapacity) || numericCapacity <= 0) {
      setError("Capacity must be a positive number.");
      return;
    }

    setSaving(true);
    setError("");

    const finalClassName = name.trim();

    const selectedYear = academicYears.find(
      (year) => year.id === academicYearId,
    );

    const selectedSection = academicSections.find(
      (item) =>
        item.id === academicSectionId &&
        item.academic_year_id === academicYearId &&
        item.is_active,
    );

    if (!selectedSection) {
      setError("Please select a valid section for this academic year.");
      setSaving(false);
      return;
    }

    if (signatureFile && !classTeacherId) {
      setError("Select a class teacher before uploading a signature.");
      setSaving(false);
      return;
    }

    if (signatureFile && classTeacherId) {
      const signaturePath = `${schoolId}/${classTeacherId}/signature.${signatureFile.name.split(".").pop()?.toLowerCase() || "png"}`;
      const { error: signatureUploadError } = await supabase.storage
        .from("teacher-signatures")
        .upload(signaturePath, signatureFile, {
          upsert: true,
          contentType: signatureFile.type,
          cacheControl: "3600",
        });

      if (signatureUploadError) {
        setError(`Signature upload failed: ${signatureUploadError.message}`);
        setSaving(false);
        return;
      }

      const { error: signatureRecordError } = await supabase
        .from("teachers")
        .update({ signature_path: signaturePath })
        .eq("id", classTeacherId)
        .eq("school_id", schoolId);

      if (signatureRecordError) {
        setError(`Signature file uploaded, but could not be linked to the teacher: ${signatureRecordError.message}`);
        setSaving(false);
        return;
      }
    }

    const payload = {
      name: finalClassName,
      section: selectedSection.name,
      academic_year_id: academicYearId,
      academic_section_id: academicSectionId,
      academic_year: selectedYear?.name ?? null,
      capacity: numericCapacity,
      class_teacher_id: classTeacherId || null,
      school_id: schoolId,
    };

    if (editingClass) {
      const { error: updateError } = await supabase
        .from("classes")
        .update(payload)
        .eq("id", editingClass.id)
        .eq("school_id", schoolId);

      if (updateError) {
        setError(updateError.message);
        setSaving(false);
        return;
      }
    } else {
      const { error: insertError } = await supabase
        .from("classes")
        .insert(payload);

      if (insertError) {
        setError(insertError.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    onSaved();
  }

  return (
    <Modal title={editingClass ? "Edit class" : "Add class"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <ErrorBox message={error} />}

        {/* Class name */}
        <Input
          label="Class name"
          value={name}
          onChange={setName}
          placeholder="e.g. Little Stars"
          required
        />

        {/* Class teacher */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Class teacher / Head teacher
          </label>
          <select
            value={classTeacherId}
            onChange={(event) => {
              setClassTeacherId(event.target.value);
              setSignatureFile(null);
            }}
            className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          >
            <option value="">Not assigned yet</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacherDisplayName(teacher)}{teacher.email ? ` — ${teacher.email}` : ""}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-slate-500">
            This teacher's name will appear on the report card. You can optionally upload their saved signature image; otherwise, the printed report will include a blank signature line.
          </p>
          {classTeacherId && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              {teachers.find((teacher) => teacher.id === classTeacherId)?.signature_path && !signatureFile ? (
                <p className="mb-2 text-xs font-medium text-emerald-700">A saved signature is available for this teacher.</p>
              ) : null}
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                {teachers.find((teacher) => teacher.id === classTeacherId)?.signature_path ? "Replace signature image (optional)" : "Upload signature image (optional)"}
              </label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => setSignatureFile(event.target.files?.[0] ?? null)}
                className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-2 file:text-xs file:font-semibold file:text-slate-700"
              />
              <p className="mt-1.5 text-[11px] text-slate-500">PNG, JPG or WebP. Use a transparent background where possible.</p>
            </div>
          )}
          {teachers.length === 0 && (
            <p className="mt-1 text-xs text-amber-600">
              No teacher profiles are available for this school yet. Add teachers first, or leave this unassigned and return later.
            </p>
          )}
        </div>

        {/* Section + Academic Year */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Section
              <span className="ml-1 text-red-500">*</span>
            </label>

            <select
              value={academicSectionId}
              onChange={(event) => setAcademicSectionId(event.target.value)}
              required
              disabled={!academicYearId}
              className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">Select section</option>

              {academicSections
                .filter(
                  (item) =>
                    item.academic_year_id === academicYearId &&
                    item.is_active,
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>

            {academicYearId &&
              academicSections.filter(
                (item) =>
                  item.academic_year_id === academicYearId &&
                  item.is_active,
              ).length === 0 && (
                <p className="mt-1.5 text-xs text-amber-600">
                  Create sections for this academic year in Academic Settings first.
                </p>
              )}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Academic year
              <span className="ml-1 text-red-500">*</span>
            </label>

            <select
              value={academicYearId}
              onChange={(event) => setAcademicYearId(event.target.value)}
              required
              disabled={academicYears.length === 0}
              className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">Select academic year</option>

              {academicYears
                .filter((year) => year.is_active)
                .map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.name}
                  </option>
                ))}
            </select>

            {academicYears.length === 0 && (
              <p className="mt-1.5 text-xs text-amber-600">
                Create an academic year first.
              </p>
            )}
          </div>
        </div>

        {/* Capacity */}
        <Input
          label="Capacity"
          value={capacity}
          onChange={setCapacity}
          placeholder="e.g. 20"
          type="number"
          min="1"
          required
        />

        <ModalActions
          onClose={onClose}
          saving={saving}
          label={editingClass ? "Save changes" : "Create class"}
        />
      </form>
    </Modal>
  );
}
/* -------------------------------------------------------------------------- */
/* Subject modal                                                               */
/* -------------------------------------------------------------------------- */

function SubjectModal({
  schoolId,
  editingSubject,
  onClose,
  onSaved,
}: {
  schoolId: string;
  editingSubject: Subject | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(editingSubject?.name ?? "");

  const [code, setCode] = useState(editingSubject?.code ?? "");

  const [description, setDescription] = useState(
    editingSubject?.description ?? "",
  );

  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!name.trim()) {
      setError("Subject name is required.");
      return;
    }

    setSaving(true);
    setError("");

    const payload = {
      name: name.trim(),
      code: code.trim() || null,
      description: description.trim() || null,
      school_id: schoolId,
    };

    if (editingSubject) {
      const { error: updateError } = await supabase
        .from("subjects")
        .update(payload)
        .eq("id", editingSubject.id)
        .eq("school_id", schoolId);

      if (updateError) {
        setError(updateError.message);
        setSaving(false);
        return;
      }
    } else {
      const { error: insertError } = await supabase
        .from("subjects")
        .insert(payload);

      if (insertError) {
        setError(insertError.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    onSaved();
  }

  return (
    <Modal
      title={editingSubject ? "Edit subject" : "Add subject"}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <ErrorBox message={error} />}

        <Input
          label="Subject name"
          value={name}
          onChange={setName}
          placeholder="e.g. Mathematics"
          required
        />

        <Input
          label="Subject code"
          value={code}
          onChange={setCode}
          placeholder="e.g. MATH"
        />

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Description
          </label>

          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            placeholder="Optional description"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
        </div>

        <ModalActions
          onClose={onClose}
          saving={saving}
          label={editingSubject ? "Save changes" : "Create subject"}
        />
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Assign subjects                                                             */
/* -------------------------------------------------------------------------- */

function ClassSubjectsModal({
  schoolId,
  schoolClass,
  subjects,
  classSubjects,
  onClose,
  onSaved,
}: {
  schoolId: string;
  schoolClass: SchoolClass;
  subjects: Subject[];
  classSubjects: ClassSubject[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const assignedIds = new Set(
    classSubjects
      .filter((item) => item.class_id === schoolClass.id)
      .map((item) => item.subject_id),
  );

  const [selectedIds, setSelectedIds] = useState<string[]>(
    Array.from(assignedIds),
  );

  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");

  function toggleSubject(subjectId: string) {
    setSelectedIds((current) =>
      current.includes(subjectId)
        ? current.filter((id) => id !== subjectId)
        : [...current, subjectId],
    );
  }

  async function saveAssignments() {
    setSaving(true);
    setError("");

    const { error: deleteError } = await supabase
      .from("class_subjects")
      .delete()
      .eq("class_id", schoolClass.id)
      .eq("school_id", schoolId);

    if (deleteError) {
      setError(deleteError.message);
      setSaving(false);
      return;
    }

    if (selectedIds.length > 0) {
      const rows = selectedIds.map((subjectId) => ({
        school_id: schoolId,
        class_id: schoolClass.id,
        subject_id: subjectId,
      }));

      const { error: insertError } = await supabase
        .from("class_subjects")
        .insert(rows);

      if (insertError) {
        setError(insertError.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    onSaved();
  }

  return (
    <Modal
      title={`Subjects for ${schoolClass.name}`}
      onClose={onClose}
      maxWidth="max-w-xl"
    >
      <div>
        <p className="mb-4 text-sm text-slate-500">
          Select the subjects taught in this class.
        </p>

        {error && (
          <div className="mb-4">
            <ErrorBox message={error} />
          </div>
        )}

        {subjects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center">
            <BookOpen size={22} className="mx-auto text-slate-300" />

            <p className="mt-2 text-sm font-medium text-slate-700">
              No subjects available
            </p>

            <p className="mt-1 text-xs text-slate-500">
              Create subjects first, then assign them to this class.
            </p>
          </div>
        ) : (
          <div className="max-h-[420px] space-y-2 overflow-y-auto">
            {subjects
              .filter((subject) => subject.is_active)
              .map((subject) => {
                const selected = selectedIds.includes(subject.id);

              return (
                <button
                  key={subject.id}
                  type="button"
                  onClick={() => toggleSubject(subject.id)}
                  className={[
                    "flex w-full items-center gap-3 rounded-xl border p-4 text-left transition",
                    selected
                      ? "border-indigo-300 bg-indigo-50"
                      : "border-slate-200 hover:bg-slate-50",
                    !subject.is_active ? "opacity-60" : "",
                  ].join(" ")}
                >
                  <div
                    className={[
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                      selected
                        ? "border-indigo-600 bg-indigo-600 text-white"
                        : "border-slate-300 bg-white",
                    ].join(" ")}
                  >
                    {selected && <Check size={13} />}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-900">
                      {subject.name}
                    </div>

                    {subject.code && (
                      <div className="mt-1 text-xs text-slate-500">
                        {subject.code}
                      </div>
                    )}
                  </div>

                  {!subject.is_active && (
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-500">
                      Inactive
                    </span>
                  )}
                </button>
              );
              })}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-4">
          <p className="text-xs text-slate-500">
            {selectedIds.length}{" "}
            {selectedIds.length === 1 ? "subject" : "subjects"} selected
          </p>

          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>

            <Button onClick={saveAssignments} disabled={saving}>
              {saving ? "Saving..." : "Save subjects"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Reusable UI                                                                 */
/* -------------------------------------------------------------------------- */

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  onAction,
  showAction = true,
}: {
  icon: typeof Users;
  title: string;
  description: string;
  action?: string;
  onAction?: () => void;
  showAction?: boolean;
}) {
  return (
    <div className="p-12 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
        <Icon size={22} />
      </div>

      <h3 className="mt-4 text-sm font-semibold text-slate-800">{title}</h3>

      <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
        {description}
      </p>

      {showAction && action && onAction && (
        <Button className="mt-5" onClick={onAction}>
          <Plus size={15} />
          {action}
        </Button>
      )}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
  maxWidth = "max-w-lg",
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  maxWidth?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        className={["w-full rounded-2xl bg-white shadow-xl", maxWidth].join(
          " ",
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={17} />
          </button>
        </div>

        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  type = "text",
  min,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
  min?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </label>

      <input
        type={type}
        min={min}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
      />
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
      <p className="text-xs text-red-600">{message}</p>
    </div>
  );
}

function ModalActions({
  onClose,
  saving,
  label,
}: {
  onClose: () => void;
  saving: boolean;
  label: string;
}) {
  return (
    <div className="flex justify-end gap-2 border-t border-slate-200 pt-5">
      <Button
        type="button"
        variant="secondary"
        onClick={onClose}
        disabled={saving}
      >
        Cancel
      </Button>

      <Button type="submit" disabled={saving}>
        {saving ? "Saving..." : label}
      </Button>
    </div>
  );
}
