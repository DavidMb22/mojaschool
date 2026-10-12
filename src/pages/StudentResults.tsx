import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  GraduationCap,
  Loader2,
  Printer,
  Search,
  User,
  Users,
} from "lucide-react";

import { useSchool } from "../context/SchoolContext";
import { getStudents } from "../lib/students";
import { supabase } from "../lib/supabase";
import {
  loadActiveAssessmentScheme,
  loadActiveReportCardTemplate,
  type AssessmentCategory,
  type AssessmentScheme,
  type CalculationMethod,
  type GradingBand,
  type SchoolReportCardTemplate,
} from "../lib/assessmentSchemes";

import Avatar from "../components/ui/Avatar";
import Badge from "../components/ui/Badge";
import Card from "../components/ui/Card";

interface Student {
  id: string;
  name: string;
  studentId: string;
  className: string;
  academicYearId: string | null;
  dateOfBirth: string | null;
  age: number | null;
  gender: "Male" | "Female";
  nationality: string;
  photoUrl: string | null;
  parent: string;
  parentPhone: string;
  status: "Active" | "Inactive";
  enrolledDate: string;
}

interface AcademicYear {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  is_active: boolean;
}

interface Assessment {
  id: string;
  title: string;
  assessment_type: string | null;
  assessment_date: string;
  max_marks: number;
  subject_id: string;
  class_id: string;
  academic_year_id: string;
  status: "Draft" | "Published";
  assessment_scheme_id?: string | null;
  assessment_category_id?: string | null;
}

interface Subject {
  id: string;
  name: string;
  code: string | null;
}

interface AssessmentResult {
  id: string;
  assessment_id: string;
  student_id: string;
  marks: number | null;
  grade: string | null;
  remarks: string | null;
}

interface ClassAssessmentResult {
  assessment_id: string;
  student_id: string;
  marks: number | null;
}

interface Enrollment {
  id: string;
  student_id: string;
  class_id: string;
  academic_year_id: string | null;
  status: string;
}

interface SubjectResult {
  subjectId: string;
  subjectName: string;
  subjectCode: string | null;
  assessments: {
    id: string;
    title: string;
    type: string;
    date: string;
    marks: number | null;
    maxMarks: number;
    percentage: number | null;
    grade: string;
    remarks: string | null;
    categoryId: string | null;
    categoryKey: string | null;
    schemeId: string | null;
  }[];
  average: number | null;
  classAverage: number | null;
  grade: string;
  teacherName: string;
}

type Term = "Term 1" | "Term 2" | "Term 3";

type ReportCardTemplateKey =
  | "high-gate-primary-v1"
  | "high-gate-nursery-v1"
  | "high-gate-auto-v1"
  | "standard-v1";

/**
 * Report card templates are deliberately school-specific. High Gate is the
 * only custom physical template configured in this release. A neutral
 * standard template is used for other schools until their own design is
 * provided and configured; High Gate branding must never leak across schools.
 *
 * In a future template-builder phase this resolver can read a stored template
 * key from school configuration, without changing the report data pipeline.
 */
function normalizeSchoolIdentifier(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function resolveReportCardTemplateKey(
  schoolName: string | null | undefined,
  schoolSlug: string | null | undefined,
  nursery: boolean,
): ReportCardTemplateKey {
  const identities = [
    normalizeSchoolIdentifier(schoolSlug),
    normalizeSchoolIdentifier(schoolName),
  ];
  const isHighGate = identities.some((identity) =>
    /^(highgateinternationalacademy|highgateinternationalacademy[0-9]+|highgateinternational)$/.test(
      identity,
    ),
  );

  if (!isHighGate) return "standard-v1";
  return nursery ? "high-gate-nursery-v1" : "high-gate-primary-v1";
}

function resolveConfiguredTemplateKey(
  configuredKey: string | null | undefined,
  schoolName: string | null | undefined,
  schoolSlug: string | null | undefined,
  nursery: boolean,
): ReportCardTemplateKey {
  // A stored template key must never allow another school to render High Gate
  // branding, even if a configuration row is accidentally misassigned.
  const isHighGate = [schoolSlug, schoolName].some((value) => {
    const identity = normalizeSchoolIdentifier(value);
    return /^(highgateinternationalacademy|highgateinternationalacademy[0-9]+|highgateinternational)$/.test(identity);
  });
  if (!isHighGate) return "standard-v1";

  if (configuredKey === "high-gate-auto-v1") {
    return nursery ? "high-gate-nursery-v1" : "high-gate-primary-v1";
  }
  if (configuredKey === "high-gate-primary-v1" || configuredKey === "high-gate-nursery-v1") {
    return configuredKey;
  }
  if (configuredKey === "standard-v1") return "standard-v1";
  return resolveReportCardTemplateKey(schoolName, schoolSlug, nursery);
}

/* =========================================================
   CONFIGURABLE SCHOOL ASSESSMENT RULES
========================================================= */

function getConfiguredGrade(
  percentage: number | null,
  gradingScale: GradingBand[],
): string {
  if (percentage === null || Number.isNaN(percentage)) return "-";
  const matchingBand = [...gradingScale]
    .sort((a, b) => a.display_order - b.display_order)
    .find((band) => percentage >= Number(band.min_percentage) && percentage <= Number(band.max_percentage));
  return matchingBand?.grade ?? getGrade(percentage);
}

function normalizedAssessmentKey(value: string | null | undefined): string {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function calculateAverageFromScheme(
  rows: SubjectResult["assessments"],
  categories: AssessmentCategory[],
  schemeId: string | null,
  calculationMethod: CalculationMethod | null,
): number | null {
  const validRows = rows.filter((row) => row.percentage !== null);
  if (validRows.length === 0) return null;
  const scopedCategories = categories.filter((category) =>
    category.enabled && category.contributes_to_total && (!schemeId || category.scheme_id === schemeId),
  );
  if (scopedCategories.length === 0 || !calculationMethod) {
    return validRows.reduce((total, row) => total + Number(row.percentage), 0) / validRows.length;
  }

  const categoryScores = scopedCategories.map((category) => {
    const matchingRows = validRows.filter((row) => {
      if (row.categoryId) return row.categoryId === category.id;
      return row.categoryKey === category.category_key ||
        normalizedAssessmentKey(row.type) === normalizedAssessmentKey(category.label) ||
        normalizedAssessmentKey(row.type) === normalizedAssessmentKey(category.category_key);
    });
    if (matchingRows.length === 0) return null;
    const percentage = matchingRows.reduce((total, row) => total + Number(row.percentage), 0) / matchingRows.length;
    return { category, percentage };
  }).filter((item): item is { category: AssessmentCategory; percentage: number } => item !== null);

  // A required component with no mark means the final term score is not yet
  // complete. Avoid presenting a misleading 100% based on CAT I alone.
  const missingRequiredCategory = scopedCategories.some((category) => {
    if (!category.is_required) return false;
    return !validRows.some((row) => {
      if (row.categoryId) return row.categoryId === category.id;
      return row.categoryKey === category.category_key ||
        normalizedAssessmentKey(row.type) === normalizedAssessmentKey(category.label) ||
        normalizedAssessmentKey(row.type) === normalizedAssessmentKey(category.category_key);
    });
  });
  if (missingRequiredCategory) return null;

  if (categoryScores.length === 0) {
    return validRows.reduce((total, row) => total + Number(row.percentage), 0) / validRows.length;
  }

  if (calculationMethod === "total_to_percentage") {
    const denominator = categoryScores.reduce((total, item) => total + Number(item.category.max_marks), 0);
    if (denominator <= 0) return null;
    const earnedEquivalent = categoryScores.reduce(
      (total, item) => total + (item.percentage / 100) * Number(item.category.max_marks),
      0,
    );
    return (earnedEquivalent / denominator) * 100;
  }

  if (calculationMethod === "weighted_average") {
    const weightedRows = categoryScores.filter((item) => Number(item.category.weight_percent ?? 0) > 0);
    const totalWeight = weightedRows.reduce((total, item) => total + Number(item.category.weight_percent ?? 0), 0);
    if (totalWeight <= 0) return null;
    return weightedRows.reduce(
      (total, item) => total + item.percentage * Number(item.category.weight_percent ?? 0),
      0,
    ) / totalWeight;
  }

  return categoryScores.reduce((total, item) => total + item.percentage, 0) / categoryScores.length;
}

/* =========================================================
   GRADING
========================================================= */

function getGrade(percentage: number | null): string {
  if (percentage === null || Number.isNaN(percentage)) {
    return "-";
  }

  if (percentage >= 90) return "A*";
  if (percentage >= 80) return "A";
  if (percentage >= 70) return "B";
  if (percentage >= 60) return "C";
  if (percentage >= 50) return "D";
  if (percentage >= 40) return "E";
  if (percentage >= 30) return "F";
  if (percentage >= 20) return "G";

  return "U";
}

function getGradeDescription(grade: string): string {
  switch (grade) {
    case "A*":
      return "Outstanding";
    case "A":
      return "Excellent";
    case "B":
      return "Very Good";
    case "C":
      return "Good";
    case "D":
      return "Satisfactory";
    case "E":
      return "Pass";
    case "F":
      return "Weak";
    case "G":
      return "Very Weak";
    case "U":
      return "Ungraded";
    default:
      return "-";
  }
}

/* =========================================================
   DATE HELPERS
========================================================= */

function formatDate(date: string | null | undefined): string {
  if (!date) return "-";

  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getTermDateRange(
  term: Term,
  academicYear: AcademicYear | null,
): { start: string; end: string } | null {
  if (!academicYear) return null;

  const academicStart = new Date(academicYear.start_date);

  if (Number.isNaN(academicStart.getTime())) {
    return null;
  }

  const startYear = academicStart.getFullYear();

  if (term === "Term 1") {
    return {
      start: `${startYear}-08-01`,
      end: `${startYear}-12-31`,
    };
  }

  if (term === "Term 2") {
    return {
      start: `${startYear + 1}-01-01`,
      end: `${startYear + 1}-03-31`,
    };
  }

  return {
    start: `${startYear + 1}-04-01`,
    end: `${startYear + 1}-07-31`,
  };
}

/* =========================================================
   ASSESSMENT HELPERS
========================================================= */

function getAssessmentTypeLabel(type: string | null): string {
  if (!type) return "Assessment";

  const normalized = type.toLowerCase();

  if (normalized.includes("cat 1") || normalized.includes("cat i")) {
    return "CAT I";
  }

  if (normalized.includes("cat 2") || normalized.includes("cat ii")) {
    return "CAT II";
  }

  if (
    normalized.includes("class") ||
    normalized.includes("cp") ||
    normalized.includes("c.p")
  ) {
    return "C.P";
  }

  if (normalized.includes("homework") || normalized.includes("hw")) {
    return "HW&Pr";
  }

  if (normalized.includes("exam")) {
    return "Exam";
  }

  return type;
}

function getPercentage(marks: number | null, maxMarks: number): number | null {
  if (
    marks === null ||
    !Number.isFinite(Number(marks)) ||
    !Number.isFinite(Number(maxMarks)) ||
    Number(maxMarks) <= 0
  ) {
    return null;
  }

  return (Number(marks) / Number(maxMarks)) * 100;
}

/* =========================================================
   PAGE
========================================================= */

export default function StudentResults() {
  const { school } = useSchool();

  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);

  const [students, setStudents] = useState<Student[]>([]);

  const [selectedAcademicYearId, setSelectedAcademicYearId] = useState("");

  const [selectedTerm, setSelectedTerm] = useState<Term>("Term 1");

  const [selectedStudentId, setSelectedStudentId] = useState("");

  const [search, setSearch] = useState("");

  const [assessments, setAssessments] = useState<Assessment[]>([]);

  const [subjects, setSubjects] = useState<Subject[]>([]);

  const [teacherNames, setTeacherNames] = useState<Record<string, string>>({});

  const [assessmentResults, setAssessmentResults] = useState<
    AssessmentResult[]
  >([]);

  const [classAssessmentResults, setClassAssessmentResults] = useState<
    ClassAssessmentResult[]
  >([]);

  const [selectedEnrollment, setSelectedEnrollment] =
    useState<Enrollment | null>(null);

  const [selectedSectionName, setSelectedSectionName] =
    useState("");
  const [classTeacherName, setClassTeacherName] = useState("");
  const [classTeacherSignaturePath, setClassTeacherSignaturePath] = useState("");
  const [classTeacherSignatureUrl, setClassTeacherSignatureUrl] = useState("");
  const [principalName, setPrincipalName] = useState("");
  const [principalSignatureUrl, setPrincipalSignatureUrl] = useState("");
  const [activeAssessmentScheme, setActiveAssessmentScheme] = useState<AssessmentScheme | null>(null);
  const [reportAssessmentCategories, setReportAssessmentCategories] = useState<AssessmentCategory[]>([]);
  const [gradingScale, setGradingScale] = useState<GradingBand[]>([]);
  const [gradingScalesBySchemeId, setGradingScalesBySchemeId] = useState<Record<string, GradingBand[]>>({});
  const [schemeMethodsById, setSchemeMethodsById] = useState<Record<string, CalculationMethod>>({});
  const [databaseReportTemplate, setDatabaseReportTemplate] = useState<SchoolReportCardTemplate | null>(null);

  const [loading, setLoading] = useState(true);

  const [loadingResults, setLoadingResults] = useState(false);

  const [error, setError] = useState("");

  const [printing, setPrinting] = useState(false);

  /* =======================================================
     INITIAL DATA
  ======================================================= */

  useEffect(() => {
    if (!school) {
      setLoading(false);
      return;
    }

    const schoolId = school.id;

    let cancelled = false;

    async function loadInitialData() {
      try {
        setLoading(true);
        setError("");

        const [academicYearsResponse, studentsResponse] =
          await Promise.all([
            supabase
              .from("academic_years")
              .select("id, name, start_date, end_date, is_current, is_active")
              .eq("school_id", schoolId)
              .order("start_date", {
                ascending: false,
              }),


            getStudents(schoolId),
          ]);

        if (cancelled) return;

        if (academicYearsResponse.error) {
          throw academicYearsResponse.error;
        }

        setAcademicYears((academicYearsResponse.data as AcademicYear[]) ?? []);

        setStudents(studentsResponse.data ?? []);

        const loadedYears =
          (academicYearsResponse.data as AcademicYear[]) ?? [];

        const currentYear =
          loadedYears.find((year) => year.is_current) ??
          loadedYears.find((year) => year.is_active) ??
          loadedYears[0];

        if (currentYear) {
          setSelectedAcademicYearId(currentYear.id);
        }
      } catch (err) {
        console.error("Error loading Student Results:", err);

        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load student results.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadInitialData();

    return () => {
      cancelled = true;
    };
  }, [school]);

  /* =======================================================
     SELECTED ACADEMIC YEAR
  ======================================================= */

  const selectedAcademicYear = useMemo(() => {
    return (
      academicYears.find((year) => year.id === selectedAcademicYearId) ?? null
    );
  }, [academicYears, selectedAcademicYearId]);

  /* =======================================================
     STUDENTS FOR SELECTED YEAR
  ======================================================= */

  const yearStudents = useMemo(() => {
    if (!selectedAcademicYearId) {
      return [];
    }

    return students.filter(
      (student) =>
        student.status === "Active" &&
        student.academicYearId === selectedAcademicYearId,
    );
  }, [students, selectedAcademicYearId]);

  /* =======================================================
     SEARCH STUDENTS
  ======================================================= */

  const filteredStudents = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return yearStudents;
    }

    return yearStudents.filter((student) => {
      return (
        student.name.toLowerCase().includes(query) ||
        student.studentId.toLowerCase().includes(query) ||
        student.className.toLowerCase().includes(query)
      );
    });
  }, [yearStudents, search]);

  /* =======================================================
     SELECTED STUDENT
  ======================================================= */

  const selectedStudent = useMemo(() => {
    return students.find((student) => student.id === selectedStudentId) ?? null;
  }, [students, selectedStudentId]);

  /* =======================================================
     KEEP STUDENT SELECTION VALID
  ======================================================= */

  useEffect(() => {
    if (
      selectedStudentId &&
      yearStudents.some((student) => student.id === selectedStudentId)
    ) {
      return;
    }

    if (yearStudents.length > 0) {
      setSelectedStudentId(yearStudents[0].id);
    } else {
      setSelectedStudentId("");
    }
  }, [selectedStudentId, yearStudents]);

  /* =======================================================
     LOAD RESULTS
  ======================================================= */

  useEffect(() => {
    if (!school || !selectedStudent || !selectedAcademicYearId) {
      setSelectedEnrollment(null);
      setSelectedSectionName("");
      setClassTeacherName("");
      setClassTeacherSignaturePath("");
      setClassTeacherSignatureUrl("");
      setAssessments([]);
      setSubjects([]);
      setTeacherNames({});
      setAssessmentResults([]);
      setClassAssessmentResults([]);
      setActiveAssessmentScheme(null);
      setReportAssessmentCategories([]);
      setGradingScale([]);
      setGradingScalesBySchemeId({});
      setSchemeMethodsById({});
      setDatabaseReportTemplate(null);
      return;
    }

    const schoolId = school.id;
    const student = selectedStudent;
    const academicYearId = selectedAcademicYearId;
    const academicYear = selectedAcademicYear;

    let cancelled = false;

    async function loadResults() {
      try {
        setLoadingResults(true);
        setError("");
        setClassTeacherName("");
        setClassTeacherSignaturePath("");
        setClassTeacherSignatureUrl("");
        setAssessmentResults([]);
        setClassAssessmentResults([]);
        setActiveAssessmentScheme(null);
        setReportAssessmentCategories([]);
        setGradingScale([]);
        setGradingScalesBySchemeId({});
        setSchemeMethodsById({});
        setDatabaseReportTemplate(null);

        /* -----------------------------------------------
           ENROLLMENT
        ------------------------------------------------ */

        const { data: enrollmentData, error: enrollmentError } = await supabase
          .from("enrollments")
          .select(
            `
              id,
              student_id,
              class_id,
              academic_year_id,
              status
            `,
          )
          .eq("school_id", schoolId)
          .eq("student_id", student.id)
          .eq("academic_year_id", academicYearId)
          .eq("status", "Active")
          .maybeSingle();

        if (enrollmentError) {
          throw enrollmentError;
        }

        if (cancelled) return;

        const enrollment = (enrollmentData as Enrollment | null) ?? null;

        setSelectedEnrollment(enrollment);

        if (!enrollment) {
          setSelectedSectionName("");
          setClassTeacherName("");
          setClassTeacherSignaturePath("");
          setClassTeacherSignatureUrl("");
          setAssessments([]);
          setSubjects([]);
          setTeacherNames({});
          setAssessmentResults([]);
          setClassAssessmentResults([]);
          setActiveAssessmentScheme(null);
          setReportAssessmentCategories([]);
          setGradingScale([]);
          setGradingScalesBySchemeId({});
          setSchemeMethodsById({});
          setDatabaseReportTemplate(null);
          return;
        }

        /*
         * Determine the report-card type from the student's
         * enrolled class and its academic section.
         *
         * This uses the same classes.academic_section_id
         * relationship used by Classes & Subjects.
         */
        const { data: classData, error: classError } =
          await supabase
            .from("classes")
            .select("id, academic_section_id, class_teacher_id")
            .eq("school_id", schoolId)
            .eq("id", enrollment.class_id)
            .maybeSingle();

        if (classError) {
          throw classError;
        }

        let sectionName = "";
        let resolvedClassTeacherName = "";
        let resolvedClassTeacherSignaturePath = "";

        if (classData?.class_teacher_id) {
          const { data: classTeacherData, error: classTeacherError } =
            await supabase
              .from("teachers")
              .select("id, first_name, middle_name, last_name, signature_path")
              .eq("school_id", schoolId)
              .eq("id", classData.class_teacher_id)
              .maybeSingle();

          if (classTeacherError) throw classTeacherError;
          if (classTeacherData) {
            resolvedClassTeacherName = [
              classTeacherData.first_name,
              classTeacherData.middle_name,
              classTeacherData.last_name,
            ].filter(Boolean).join(" ");
            resolvedClassTeacherSignaturePath = classTeacherData.signature_path ?? "";
          }
        }

        if (classData?.academic_section_id) {
          const { data: sectionData, error: sectionError } =
            await supabase
              .from("academic_sections")
              .select("id, name")
              .eq("id", classData.academic_section_id)
              .maybeSingle();

          if (sectionError) {
            throw sectionError;
          }

          sectionName = sectionData?.name ?? "";
        }

        if (cancelled) return;

        setSelectedSectionName(sectionName);
        setClassTeacherName(resolvedClassTeacherName);
        setClassTeacherSignaturePath(resolvedClassTeacherSignaturePath);
        setClassTeacherSignatureUrl("");

        // Load the scheme and report template scoped to this school's class,
        // section and academic year. Configuration failures fall back to the
        // legacy behaviour instead of blocking student results.
        let activeBundle: {
          scheme: AssessmentScheme | null;
          categories: AssessmentCategory[];
          grades: GradingBand[];
        } = { scheme: null, categories: [], grades: [] };
        try {
          activeBundle = await loadActiveAssessmentScheme(
            schoolId,
            academicYearId,
            classData?.academic_section_id ?? null,
          );
        } catch (schemeError) {
          console.warn("Assessment scheme is not available; using compatibility calculation:", schemeError);
        }
        let selectedTemplate: SchoolReportCardTemplate | null = null;
        try {
          selectedTemplate = await loadActiveReportCardTemplate(
            schoolId,
            academicYearId,
            classData?.academic_section_id ?? null,
          );
        } catch (templateError) {
          console.warn("Report-card template settings are not available; using the legacy template resolver:", templateError);
        }
        if (cancelled) return;
        setActiveAssessmentScheme(activeBundle.scheme);
        setReportAssessmentCategories(activeBundle.categories);
        setGradingScale(activeBundle.grades);
        setGradingScalesBySchemeId(activeBundle.scheme ? { [activeBundle.scheme.id]: activeBundle.grades } : {});
        setSchemeMethodsById(activeBundle.scheme ? { [activeBundle.scheme.id]: activeBundle.scheme.calculation_method } : {});
        setDatabaseReportTemplate(selectedTemplate);

        /* -----------------------------------------------
           TERM RANGE
        ------------------------------------------------ */

        const dateRange = getTermDateRange(selectedTerm, academicYear);

        if (!dateRange) {
          setAssessments([]);
          setSubjects([]);
          setTeacherNames({});
          setAssessmentResults([]);
          setClassAssessmentResults([]);
          return;
        }

        /* -----------------------------------------------
           ASSESSMENTS
        ------------------------------------------------ */

        const { data: assessmentData, error: assessmentError } = await supabase
          .from("assessments")
          .select(
            `
              id,
              title,
              assessment_type,
              assessment_date,
              max_marks,
              subject_id,
              class_id,
              academic_year_id,
              status,
              assessment_scheme_id,
              assessment_category_id
            `,
          )
          .eq("school_id", schoolId)
          .eq("academic_year_id", academicYearId)
          .eq("class_id", enrollment.class_id)
          .eq("status", "Published")
          .gte("assessment_date", dateRange.start)
          .lte("assessment_date", dateRange.end)
          .order("assessment_date", {
            ascending: true,
          });

        if (assessmentError) {
          throw assessmentError;
        }

        const loadedAssessments = (assessmentData as Assessment[]) ?? [];

        // Fetch historical category rows for scheme versions already linked to
        // assessments. New scheme versions must not silently reinterpret old
        // marks when a school updates its setup mid-year.
        const linkedSchemeIds = Array.from(new Set(
          loadedAssessments.map((assessment) => assessment.assessment_scheme_id).filter((id): id is string => Boolean(id)),
        ));
        let allSchemeCategories = [...activeBundle.categories];
        const allSchemeMethods: Record<string, CalculationMethod> = activeBundle.scheme
          ? { [activeBundle.scheme.id]: activeBundle.scheme.calculation_method }
          : {};
        if (linkedSchemeIds.length > 0) {
          const [
            { data: historicalCategoryRows, error: historicalCategoryError },
            { data: historicalSchemeRows, error: historicalSchemeError },
            { data: historicalGradeRows, error: historicalGradeError },
          ] = await Promise.all([
            supabase.from("school_assessment_categories")
              .select("id, scheme_id, category_key, label, max_marks, weight_percent, display_order, enabled, contributes_to_total, is_required")
              .in("scheme_id", linkedSchemeIds)
              .order("display_order", { ascending: true }),
            supabase.from("school_assessment_schemes")
              .select("id, calculation_method")
              .eq("school_id", schoolId)
              .in("id", linkedSchemeIds),
            supabase.from("school_grading_scales")
              .select("id, scheme_id, min_percentage, max_percentage, grade, description, display_order")
              .in("scheme_id", linkedSchemeIds)
              .order("display_order", { ascending: true }),
          ]);
          if (historicalCategoryError) console.warn("Unable to load historical assessment categories:", historicalCategoryError);
          else {
            const byId = new Map(allSchemeCategories.map((category) => [category.id, category]));
            ((historicalCategoryRows ?? []) as AssessmentCategory[]).forEach((category) => byId.set(category.id, category));
            allSchemeCategories = Array.from(byId.values());
          }
          if (historicalSchemeError) console.warn("Unable to load historical assessment schemes:", historicalSchemeError);
          else ((historicalSchemeRows ?? []) as { id: string; calculation_method: CalculationMethod }[]).forEach((row) => {
            allSchemeMethods[row.id] = row.calculation_method;
          });
          if (historicalGradeError) console.warn("Unable to load historical grading bands:", historicalGradeError);
          else {
            const byScheme = { ...(activeBundle.scheme ? { [activeBundle.scheme.id]: activeBundle.grades } : {}) } as Record<string, GradingBand[]>;
            ((historicalGradeRows ?? []) as GradingBand[]).forEach((band) => {
              byScheme[band.scheme_id] = [...(byScheme[band.scheme_id] ?? []), band];
            });
            Object.keys(byScheme).forEach((schemeId) => {
              const unique = new Map(byScheme[schemeId].map((band) => [band.id, band]));
              byScheme[schemeId] = Array.from(unique.values()).sort((a, b) => a.display_order - b.display_order);
            });
            setGradingScalesBySchemeId(byScheme);
          }
        } else {
          setGradingScalesBySchemeId(activeBundle.scheme ? { [activeBundle.scheme.id]: activeBundle.grades } : {});
        }

        if (cancelled) return;
        setReportAssessmentCategories(allSchemeCategories);
        setSchemeMethodsById(allSchemeMethods);
        setAssessments(loadedAssessments);

        /* -----------------------------------------------
           SUBJECTS
        ------------------------------------------------ */

        const subjectIds = Array.from(
          new Set(
            loadedAssessments
              .map((assessment) => assessment.subject_id)
              .filter(Boolean),
          ),
        );

        let loadedSubjects: Subject[] = [];

        if (subjectIds.length > 0) {
          const { data: subjectData, error: subjectError } = await supabase
            .from("subjects")
            .select("id, name, code")
            .eq("school_id", schoolId)
            .in("id", subjectIds)
            .order("name", {
              ascending: true,
            });

          if (subjectError) {
            throw subjectError;
          }

          loadedSubjects = (subjectData as Subject[]) ?? [];
        }

        if (cancelled) return;

        setSubjects(loadedSubjects);

        /* -----------------------------------------------
           TEACHER ASSIGNMENTS
        ------------------------------------------------ */

        const { data: assignmentData, error: assignmentError } =
          await supabase
            .from("teacher_assignments")
            .select(
              `
                teacher_id,
                subject_id,
                class_id,
                academic_year_id
              `,
            )
            .eq("school_id", schoolId)
            .eq("class_id", enrollment.class_id)
            .eq("academic_year_id", academicYearId)
            .in("subject_id", subjectIds);

        if (assignmentError) {
          throw assignmentError;
        }

        const assignments = (assignmentData ?? []) as {
          teacher_id: string;
          subject_id: string;
          class_id: string;
          academic_year_id: string;
        }[];

        const teacherIds = Array.from(
          new Set(
            assignments
              .map((assignment) => assignment.teacher_id)
              .filter(Boolean),
          ),
        );

        let loadedTeacherNames: Record<string, string> = {};

        if (teacherIds.length > 0) {
          const { data: teacherData, error: teacherError } =
            await supabase
              .from("teachers")
              .select(
                "id, first_name, middle_name, last_name",
              )
              .eq("school_id", schoolId)
              .in("id", teacherIds);

          if (teacherError) {
            throw teacherError;
          }

          loadedTeacherNames = Object.fromEntries(
            ((teacherData ?? []) as {
              id: string;
              first_name: string;
              middle_name: string | null;
              last_name: string;
            }[]).map((teacher) => [
              teacher.id,
              [
                teacher.first_name,
                teacher.middle_name,
                teacher.last_name,
              ]
                .filter(Boolean)
                .join(" "),
            ]),
          );
        }

        const subjectTeacherNames: Record<string, string> = {};

        assignments.forEach((assignment) => {
          const name =
            loadedTeacherNames[assignment.teacher_id];

          if (name && !subjectTeacherNames[assignment.subject_id]) {
            subjectTeacherNames[assignment.subject_id] = name;
          }
        });

        if (cancelled) return;

        setTeacherNames(subjectTeacherNames);

        /* -----------------------------------------------
           RESULTS
        ------------------------------------------------ */

        const assessmentIds = loadedAssessments.map(
          (assessment) => assessment.id,
        );

        if (assessmentIds.length === 0) {
          setAssessmentResults([]);
          setClassAssessmentResults([]);
          return;
        }

        const [studentResultsResponse, classResultsResponse] = await Promise.all([
          supabase
            .from("assessment_results")
            .select(
              `
                id,
                assessment_id,
                student_id,
                marks,
                grade,
                remarks
              `,
            )
            .eq("student_id", student.id)
            .in("assessment_id", assessmentIds),
          // Class averages are supplementary to the student's own results.
          // A permissions/policy issue here must not prevent the report card
          // from loading; the CA cell will remain blank when unavailable.
          supabase
            .from("assessment_results")
            .select("assessment_id, student_id, marks")
            .in("assessment_id", assessmentIds),
        ]);

        if (studentResultsResponse.error) {
          throw studentResultsResponse.error;
        }

        if (cancelled) return;

        setAssessmentResults(
          (studentResultsResponse.data as AssessmentResult[]) ?? [],
        );

        if (classResultsResponse.error) {
          console.warn(
            "Unable to load class-wide assessment averages:",
            classResultsResponse.error,
          );
          setClassAssessmentResults([]);
        } else {
          setClassAssessmentResults(
            (classResultsResponse.data as ClassAssessmentResult[]) ?? [],
          );
        }
      } catch (err) {
        console.error("Error loading student results:", err);

        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load student results.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingResults(false);
        }
      }
    }

    loadResults();

    return () => {
      cancelled = true;
    };
  }, [
    school,
    selectedStudent,
    selectedAcademicYearId,
    selectedTerm,
    selectedAcademicYear,
  ]);

  /* =======================================================
     SUBJECT RESULTS
  ======================================================= */

  const subjectResults = useMemo<SubjectResult[]>(() => {
    if (!selectedStudent) {
      return [];
    }

    const resultMap = new Map<string, AssessmentResult>();

    assessmentResults.forEach((result) => {
      resultMap.set(result.assessment_id, result);
    });

    const subjectMap = new Map<string, Subject>();

    subjects.forEach((subject) => {
      subjectMap.set(subject.id, subject);
    });

    const grouped = new Map<string, Assessment[]>();
    const assessmentById = new Map(
      assessments.map((assessment) => [assessment.id, assessment]),
    );
    // Build a per-student set of subject rows so class average uses the same
    // calculation scheme as each student's final subject result.
    const classAssessmentRowsBySubject = new Map<
      string,
      Map<string, SubjectResult["assessments"]>
    >();

    classAssessmentResults.forEach((classResult) => {
      const assessment = assessmentById.get(classResult.assessment_id);
      if (!assessment) return;

      const marks = classResult.marks === null ? null : Number(classResult.marks);
      const percentage = getPercentage(marks, Number(assessment.max_marks));
      const matchedCategory = (assessment.assessment_category_id
        ? reportAssessmentCategories.find((category) => category.id === assessment.assessment_category_id)
        : undefined) ?? reportAssessmentCategories.find((category) =>
          (!assessment.assessment_scheme_id || category.scheme_id === assessment.assessment_scheme_id) &&
          (normalizedAssessmentKey(assessment.assessment_type) === normalizedAssessmentKey(category.label) ||
            normalizedAssessmentKey(assessment.assessment_type) === normalizedAssessmentKey(category.category_key)),
        );
      const schemeId = assessment.assessment_scheme_id ?? matchedCategory?.scheme_id ?? null;
      const row: SubjectResult["assessments"][number] = {
        id: assessment.id,
        title: assessment.title,
        type: matchedCategory?.label ?? getAssessmentTypeLabel(assessment.assessment_type),
        date: assessment.assessment_date,
        marks,
        maxMarks: Number(assessment.max_marks),
        percentage,
        grade: getConfiguredGrade(percentage, schemeId ? gradingScalesBySchemeId[schemeId] ?? gradingScale : gradingScale),
        remarks: null,
        categoryId: assessment.assessment_category_id ?? matchedCategory?.id ?? null,
        categoryKey: matchedCategory?.category_key ?? null,
        schemeId,
      };

      const studentsForSubject = classAssessmentRowsBySubject.get(assessment.subject_id) ?? new Map<string, SubjectResult["assessments"]>();
      const studentRows = studentsForSubject.get(classResult.student_id) ?? [];
      studentRows.push(row);
      studentsForSubject.set(classResult.student_id, studentRows);
      classAssessmentRowsBySubject.set(assessment.subject_id, studentsForSubject);
    });

    assessments.forEach((assessment) => {
      if (!grouped.has(assessment.subject_id)) {
        grouped.set(assessment.subject_id, []);
      }

      grouped.get(assessment.subject_id)!.push(assessment);
    });

    return Array.from(grouped.entries())
      .map(([subjectId, subjectAssessments]) => {
        const subject = subjectMap.get(subjectId);

        const rows = subjectAssessments.map((assessment) => {
          const result = resultMap.get(assessment.id);

          const marks =
            result?.marks === null || result?.marks === undefined
              ? null
              : Number(result.marks);

          const maxMarks = Number(assessment.max_marks);

          const percentage = getPercentage(marks, maxMarks);

          const matchedCategory = (assessment.assessment_category_id
            ? reportAssessmentCategories.find((category) => category.id === assessment.assessment_category_id)
            : undefined) ?? reportAssessmentCategories.find((category) =>
              (!assessment.assessment_scheme_id || category.scheme_id === assessment.assessment_scheme_id) &&
              (normalizedAssessmentKey(assessment.assessment_type) === normalizedAssessmentKey(category.label) ||
                normalizedAssessmentKey(assessment.assessment_type) === normalizedAssessmentKey(category.category_key)),
            );
          const assessmentSchemeId = assessment.assessment_scheme_id ?? matchedCategory?.scheme_id ?? null;
          const assessmentGradingScale = assessmentSchemeId
            ? gradingScalesBySchemeId[assessmentSchemeId] ?? gradingScale
            : gradingScale;

          return {
            id: assessment.id,
            title: assessment.title,
            type: matchedCategory?.label ?? getAssessmentTypeLabel(assessment.assessment_type),
            date: assessment.assessment_date,
            marks,
            maxMarks,
            percentage,
            grade: getConfiguredGrade(percentage, assessmentGradingScale),
            remarks: result?.remarks ?? null,
            categoryId: assessment.assessment_category_id ?? matchedCategory?.id ?? null,
            categoryKey: matchedCategory?.category_key ?? null,
            schemeId: assessmentSchemeId,
          };
        });

        const rowSchemeIds = Array.from(new Set(rows.map((row) => row.schemeId).filter((id): id is string => Boolean(id))));
        const preferredSchemeId = rowSchemeIds.length === 1
          ? rowSchemeIds[0]
          : rowSchemeIds.length === 0
            ? activeAssessmentScheme?.id ?? null
            : null;
        const calculationMethod = preferredSchemeId
          ? schemeMethodsById[preferredSchemeId] ?? activeAssessmentScheme?.calculation_method ?? null
          : rowSchemeIds.length === 0 ? activeAssessmentScheme?.calculation_method ?? null : null;
        const average = calculateAverageFromScheme(
          rows,
          reportAssessmentCategories,
          preferredSchemeId,
          calculationMethod,
        );
        const studentsWithSubjectScores = classAssessmentRowsBySubject.get(subjectId);
        const classFinalScores: number[] = [];
        studentsWithSubjectScores?.forEach((studentRows) => {
          const ids = Array.from(new Set(studentRows.map((row) => row.schemeId).filter((id): id is string => Boolean(id))));
          const studentSchemeId = ids.length === 1 ? ids[0] : ids.length === 0 ? activeAssessmentScheme?.id ?? null : null;
          const studentCalculationMethod = studentSchemeId
            ? schemeMethodsById[studentSchemeId] ?? activeAssessmentScheme?.calculation_method ?? null
            : null;
          const studentFinalScore = calculateAverageFromScheme(
            studentRows,
            reportAssessmentCategories,
            studentSchemeId,
            studentCalculationMethod,
          );
          if (studentFinalScore !== null) classFinalScores.push(studentFinalScore);
        });
        const classAverage = classFinalScores.length > 0
          ? classFinalScores.reduce((total, percentage) => total + percentage, 0) / classFinalScores.length
          : null;

        const subjectSchemeIds = Array.from(new Set(rows.map((row) => row.schemeId).filter((id): id is string => Boolean(id))));
        const subjectSchemeId = subjectSchemeIds.length === 1 ? subjectSchemeIds[0] : activeAssessmentScheme?.id ?? null;
        const subjectGradingScale = subjectSchemeId ? (gradingScalesBySchemeId[subjectSchemeId] ?? gradingScale) : gradingScale;

        return {
          subjectId,
          subjectName: subject?.name ?? "Unknown Subject",
          subjectCode: subject?.code ?? null,
          assessments: rows,
          average,
          classAverage,
          grade: getConfiguredGrade(average, subjectGradingScale),
          teacherName: teacherNames[subjectId] ?? "",
        };
      })
      .sort((a, b) => a.subjectName.localeCompare(b.subjectName));
  }, [
    assessments,
    assessmentResults,
    classAssessmentResults,
    subjects,
    selectedStudent,
    teacherNames,
    reportAssessmentCategories,
    activeAssessmentScheme,
    schemeMethodsById,
    gradingScale,
    gradingScalesBySchemeId,
  ]);

  const reportSchemeId = useMemo(() => {
    const counts = new Map<string, number>();
    subjectResults.forEach((subject) => subject.assessments.forEach((assessment) => {
      if (assessment.schemeId) counts.set(assessment.schemeId, (counts.get(assessment.schemeId) ?? 0) + 1);
    }));
    const dominant = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
    return dominant ?? activeAssessmentScheme?.id ?? null;
  }, [subjectResults, activeAssessmentScheme]);

  const reportGradingScale = useMemo(
    () => reportSchemeId ? (gradingScalesBySchemeId[reportSchemeId] ?? gradingScale) : gradingScale,
    [reportSchemeId, gradingScalesBySchemeId, gradingScale],
  );

  const reportCalculationMethod = reportSchemeId
    ? schemeMethodsById[reportSchemeId] ?? activeAssessmentScheme?.calculation_method ?? null
    : activeAssessmentScheme?.calculation_method ?? null;

  /* =======================================================
     SUMMARY
  ======================================================= */

  const summary = useMemo(() => {
    const averages = subjectResults
      .map((subject) => subject.average)
      .filter((average): average is number => average !== null);

    const overallAverage =
      averages.length > 0
        ? averages.reduce((total, average) => total + average, 0) /
          averages.length
        : null;

    const totalAssessments = subjectResults.reduce(
      (total, subject) => total + subject.assessments.length,
      0,
    );

    const completedAssessments = subjectResults.reduce(
      (total, subject) =>
        total +
        subject.assessments.filter((assessment) => assessment.marks !== null)
          .length,
      0,
    );

    return {
      subjects: subjectResults.length,
      totalAssessments,
      completedAssessments,
      overallAverage,
      overallGrade: getConfiguredGrade(overallAverage, reportGradingScale),
    };
  }, [subjectResults, reportGradingScale]);

  const isNurseryStudent = useMemo(() => {
    const section = selectedSectionName.trim().toLowerCase();
    const className = (selectedStudent?.className ?? "")
      .trim()
      .toLowerCase();

    return (
      section.includes("nursery") ||
      section.includes("creche") ||
      section.includes("crèche") ||
      section.includes("preschool") ||
      section.includes("pre-school") ||
      section.includes("pre school") ||
      className.includes("nursery") ||
      className.includes("creche") ||
      className.includes("crèche") ||
      className.includes("preschool") ||
      className.includes("pre-school") ||
      className.includes("pre school")
    );
  }, [selectedSectionName, selectedStudent]);

  async function handlePrintReportCard() {
    if (!selectedStudent) {
      return;
    }

    let signedClassTeacherSignatureUrl = "";
    let resolvedPrincipalName = "";
    let resolvedPrincipalSignatureUrl = "";

    // Principal details are stored in the current school's configuration.
    // If a school has not configured them yet, report printing still works.
    if (school?.id) {
      try {
        const { data: schoolConfigData, error: schoolConfigError } = await supabase
          .from("school_configurations")
          .select("branding")
          .eq("school_id", school.id)
          .maybeSingle();

        if (schoolConfigError) throw schoolConfigError;

        const branding = schoolConfigData?.branding as Record<string, unknown> | null;
        resolvedPrincipalName = typeof branding?.principal_name === "string"
          ? branding.principal_name.trim()
          : "";
        const signaturePath = typeof branding?.principal_signature_path === "string"
          ? branding.principal_signature_path
          : "";

        if (signaturePath) {
          const { data: signatureData, error: signatureError } = await supabase.storage
            .from("teacher-signatures")
            .createSignedUrl(signaturePath, 60 * 30);
          if (signatureError) throw signatureError;
          resolvedPrincipalSignatureUrl = signatureData.signedUrl;
        }
      } catch (principalSettingsError) {
        console.warn("Unable to load principal details for the report card:", principalSettingsError);
      }
    }

    if (classTeacherSignaturePath) {
      const { data: signatureData, error: signatureError } = await supabase.storage
        .from("teacher-signatures")
        .createSignedUrl(classTeacherSignaturePath, 60 * 30);
      if (signatureError) {
        console.warn("Unable to load the class teacher signature image:", signatureError);
      } else {
        signedClassTeacherSignatureUrl = signatureData.signedUrl;
      }
    }

    setClassTeacherSignatureUrl(signedClassTeacherSignatureUrl);
    setPrincipalName(resolvedPrincipalName);
    setPrincipalSignatureUrl(resolvedPrincipalSignatureUrl);
    setPrinting(true);

    // The printable report is rendered through a portal. Make sure
    // every image has finished loading/decoding before opening the
    // browser print dialog; otherMojaSchool Chrome can capture the report
    // before the logo is painted.
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.setTimeout(resolve, 250);
      });
    });

    const printRoot = document.getElementById(
      "schoolos-report-card-print",
    );

    if (printRoot) {
      const images = Array.from(
        printRoot.querySelectorAll("img"),
      );

      await Promise.all(
        images.map(async (image) => {
          image.loading = "eager";

          if (!image.complete) {
            await new Promise<void>((resolve) => {
              const finish = () => {
                image.removeEventListener("load", finish);
                image.removeEventListener("error", finish);
                resolve();
              };

              image.addEventListener("load", finish);
              image.addEventListener("error", finish);
            });
          }

          if ("decode" in image) {
            try {
              await image.decode();
            } catch {
              // The image may already be decoded or may fail to decode.
              // In either case, let the print dialog open normally.
            }
          }
        }),
      );
    }

    window.requestAnimationFrame(() => {
      window.print();

      window.setTimeout(() => {
        setPrinting(false);
      }, 500);
    });
  }

  /* =======================================================
     LOADING SCREEN
  ======================================================= */

  if (loading) {
    return (
      <div className="flex min-h-[500px] items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading student results...
        </div>
      </div>
    );
  }

  /* =======================================================
     ERROR SCREEN
  ======================================================= */

  if (error && !selectedStudent) {
    return (
      <div className="mx-auto max-w-[1400px]">
        <Card className="border-red-200 bg-red-50 p-6">
          <h2 className="font-semibold text-red-800">
            Unable to load Student Results
          </h2>

          <p className="mt-2 text-sm text-red-700">{error}</p>
        </Card>
      </div>
    );
  }

  /* =======================================================
     UI
  ======================================================= */

  return (
    <>
      <div className="mx-auto max-w-[1400px] space-y-6">
      {/* HEADER */}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
            Academics
          </p>

          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            Student Results
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            View academic performance and assessment results for individual
            students.
          </p>
        </div>

        <button
          type="button"
          onClick={handlePrintReportCard}
          disabled={!selectedStudent || printing}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Printer size={17} />
          {printing
            ? "Preparing..."
            : isNurseryStudent
              ? "Print Nursery Report Card"
              : "Print Primary Report Card"}
        </button>
      </div>

      {/* FILTERS */}

      <Card className="p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* ACADEMIC YEAR */}

          <div>
            <label
              htmlFor="academic-year"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Academic Year
            </label>

            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

              <select
                id="academic-year"
                value={selectedAcademicYearId}
                onChange={(event) => {
                  setSelectedAcademicYearId(event.target.value);
                  setSearch("");
                }}
                className="w-full appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-10 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              >
                {academicYears.length === 0 ? (
                  <option value="">No academic years</option>
                ) : (
                  academicYears.map((year) => (
                    <option key={year.id} value={year.id}>
                      {year.name}
                      {year.is_current ? " — Current" : ""}
                    </option>
                  ))
                )}
              </select>

              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          {/* TERM */}

          <div>
            <label
              htmlFor="term"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Term
            </label>

            <div className="relative">
              <BookOpen className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

              <select
                id="term"
                value={selectedTerm}
                onChange={(event) =>
                  setSelectedTerm(event.target.value as Term)
                }
                className="w-full appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-10 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="Term 1">Term 1</option>

                <option value="Term 2">Term 2</option>

                <option value="Term 3">Term 3</option>
              </select>

              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          {/* SEARCH */}

          <div>
            <label
              htmlFor="student-search"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Search Student
            </label>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

              <input
                id="student-search"
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name, ID or class..."
                className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </div>
        </div>
      </Card>

      {/* STUDENT LIST */}

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Students</h2>

              <p className="mt-0.5 text-xs text-slate-500">
                {filteredStudents.length} student
                {filteredStudents.length === 1 ? "" : "s"} available
              </p>
            </div>

            <Users className="h-5 w-5 text-slate-400" />
          </div>
        </div>

        {filteredStudents.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
              <Users className="h-6 w-6 text-slate-400" />
            </div>

            <h3 className="mt-4 text-sm font-semibold text-slate-900">
              No students found
            </h3>

            <p className="mt-1 text-sm text-slate-500">
              There are no active students for the selected academic year
              matching your search.
            </p>
          </div>
        ) : (
          <div className="max-h-[240px] overflow-y-auto">
            <div className="grid grid-cols-1 divide-y divide-slate-100 md:grid-cols-2 md:divide-x md:divide-y">
              {filteredStudents.map((student) => {
                const isSelected = student.id === selectedStudentId;

                return (
                  <button
                    key={student.id}
                    type="button"
                    onClick={() => setSelectedStudentId(student.id)}
                    className={`flex items-center gap-3 px-5 py-3 text-left transition ${
                      isSelected ? "bg-indigo-50" : "bg-white hover:bg-slate-50"
                    }`}
                  >
                    {student.photoUrl ? (
                      <img
                        src={student.photoUrl}
                        alt={student.name}
                        className="h-10 w-10 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <Avatar name={student.name} />
                    )}

                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-sm font-medium ${
                          isSelected ? "text-indigo-700" : "text-slate-900"
                        }`}
                      >
                        {student.name}
                      </p>

                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
                        <span>{student.studentId}</span>

                        <span>•</span>

                        <span>{student.className}</span>
                      </div>
                    </div>

                    {isSelected && <Badge variant="success">Selected</Badge>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {/* INLINE ERROR */}

      {error && selectedStudent && (
        <Card className="border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </Card>
      )}

      {/* SELECTED STUDENT */}

      {selectedStudent ? (
        <div className="space-y-6">
          {/* PROFILE */}

          <Card className="p-6">
            <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-4">
                {selectedStudent.photoUrl ? (
                  <img
                    src={selectedStudent.photoUrl}
                    alt={selectedStudent.name}
                    className="h-16 w-16 rounded-2xl object-cover"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50">
                    <Avatar name={selectedStudent.name} />
                  </div>
                )}

                <div>
                  <h2 className="text-xl font-semibold text-slate-900">
                    {selectedStudent.name}
                  </h2>

                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                    <span>ID: {selectedStudent.studentId}</span>

                    <span className="hidden sm:inline">•</span>

                    <span>Class: {selectedStudent.className}</span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge variant="success">{selectedTerm}</Badge>

                    {selectedAcademicYear && (
                      <Badge variant="default">
                        {selectedAcademicYear.name}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="text-left md:text-right">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Enrollment
                </p>

                <p className="mt-1 text-sm font-medium text-slate-700">
                  {selectedEnrollment ? "Active" : "No active enrollment"}
                </p>
              </div>
            </div>
          </Card>

          {/* SUMMARY */}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Subjects
                  </p>

                  <p className="mt-2 text-2xl font-semibold text-slate-900">
                    {summary.subjects}
                  </p>
                </div>

                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50">
                  <BookOpen className="h-5 w-5 text-indigo-600" />
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Assessments
                  </p>

                  <p className="mt-2 text-2xl font-semibold text-slate-900">
                    {summary.completedAssessments}

                    <span className="ml-1 text-sm font-normal text-slate-400">
                      /{summary.totalAssessments}
                    </span>
                  </p>
                </div>

                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50">
                  <ClipboardList className="h-5 w-5 text-sky-600" />
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Overall Average
                  </p>

                  <p className="mt-2 text-2xl font-semibold text-slate-900">
                    {summary.overallAverage !== null
                      ? `${summary.overallAverage.toFixed(1)}%`
                      : "-"}
                  </p>
                </div>

                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
                  <GraduationCap className="h-5 w-5 text-emerald-600" />
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Overall Grade
                  </p>

                  <p className="mt-2 text-2xl font-semibold text-slate-900">
                    {summary.overallGrade}
                  </p>

                  <p className="mt-0.5 text-xs text-slate-400">
                    {getGradeDescription(summary.overallGrade)}
                  </p>
                </div>

                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50">
                  <span className="text-lg font-bold text-amber-600">
                    {summary.overallGrade}
                  </span>
                </div>
              </div>
            </Card>
          </div>

          {/* RESULTS */}

          {loadingResults ? (
            <Card className="p-12">
              <div className="flex items-center justify-center gap-3 text-sm text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading assessment results...
              </div>
            </Card>
          ) : (
            <>
              {/* PERFORMANCE */}

              <Card className="p-6">
                <div className="mb-5">
                  <h2 className="text-base font-semibold text-slate-900">
                    Performance Overview
                  </h2>

                  <p className="mt-1 text-sm text-slate-500">
                    Subject performance for {selectedTerm}.
                  </p>
                </div>

                {subjectResults.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 px-5 py-10 text-center">
                    <ClipboardList className="mx-auto h-8 w-8 text-slate-300" />

                    <h3 className="mt-3 text-sm font-semibold text-slate-900">
                      No published assessments
                    </h3>

                    <p className="mt-1 text-sm text-slate-500">
                      No published assessments were found for this student in{" "}
                      {selectedTerm}.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {subjectResults.map((subject) => {
                      const percentage = subject.average ?? 0;

                      return (
                        <div
                          key={subject.subjectId}
                          className="rounded-xl border border-slate-100 p-4"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                {subject.subjectName}
                              </p>

                              {subject.subjectCode && (
                                <p className="mt-0.5 text-xs text-slate-400">
                                  {subject.subjectCode}
                                </p>
                              )}
                            </div>

                            <div className="flex items-center gap-3">
                              <span className="text-sm font-semibold text-slate-700">
                                {subject.average !== null
                                  ? `${subject.average.toFixed(1)}%`
                                  : "-"}
                              </span>

                              <Badge variant="default">{subject.grade}</Badge>
                            </div>
                          </div>

                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-indigo-500 transition-all"
                              style={{
                                width: `${Math.min(
                                  100,
                                  Math.max(0, percentage),
                                )}%`,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              {/* TABLE */}

              <Card className="overflow-hidden">
                <div className="border-b border-slate-100 px-5 py-5">
                  <h2 className="text-base font-semibold text-slate-900">
                    Academic Results
                  </h2>

                  <p className="mt-1 text-sm text-slate-500">
                    Detailed assessment results for {selectedStudent.name}.
                  </p>
                </div>

                {subjectResults.length === 0 ? (
                  <div className="px-5 py-12 text-center">
                    <ClipboardList className="mx-auto h-8 w-8 text-slate-300" />

                    <p className="mt-3 text-sm text-slate-500">
                      No results available for this term.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-100">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="whitespace-nowrap px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Subject
                          </th>

                          <th className="whitespace-nowrap px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Assessment
                          </th>

                          <th className="whitespace-nowrap px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Date
                          </th>

                          <th className="whitespace-nowrap px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Marks
                          </th>

                          <th className="whitespace-nowrap px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                            %
                          </th>

                          <th className="whitespace-nowrap px-5 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Grade
                          </th>

                          <th className="whitespace-nowrap px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Remarks
                          </th>
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-100 bg-white">
                        {subjectResults.map((subject) =>
                          subject.assessments.map((assessment, index) => (
                            <tr
                              key={assessment.id}
                              className="transition hover:bg-slate-50"
                            >
                              <td className="px-5 py-4">
                                {index === 0 ? (
                                  <div>
                                    <p className="text-sm font-medium text-slate-900">
                                      {subject.subjectName}
                                    </p>

                                    {subject.subjectCode && (
                                      <p className="mt-0.5 text-xs text-slate-400">
                                        {subject.subjectCode}
                                      </p>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-slate-300">—</span>
                                )}
                              </td>

                              <td className="px-5 py-4">
                                <p className="text-sm font-medium text-slate-700">
                                  {assessment.title}
                                </p>

                                <p className="mt-0.5 text-xs text-slate-400">
                                  {assessment.type}
                                </p>
                              </td>

                              <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-600">
                                {formatDate(assessment.date)}
                              </td>

                              <td className="whitespace-nowrap px-5 py-4 text-right text-sm font-medium text-slate-700">
                                {assessment.marks !== null
                                  ? `${assessment.marks} / ${assessment.maxMarks}`
                                  : "-"}
                              </td>

                              <td className="whitespace-nowrap px-5 py-4 text-right text-sm font-medium text-slate-700">
                                {assessment.percentage !== null
                                  ? `${assessment.percentage.toFixed(1)}%`
                                  : "-"}
                              </td>

                              <td className="px-5 py-4 text-center">
                                <Badge variant="default">
                                  {assessment.grade}
                                </Badge>
                              </td>

                              <td className="min-w-[180px] px-5 py-4 text-sm text-slate-500">
                                {assessment.remarks || "-"}
                              </td>
                            </tr>
                          )),
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              {/* GRADING SCALE */}

              <Card className="p-6">
                <div className="mb-5">
                  <h2 className="text-base font-semibold text-slate-900">
                    High Gate Grading Scale
                  </h2>

                  <p className="mt-1 text-sm text-slate-500">
                    Primary school grading scale.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-9">
                  {[
                    ["A*", "90–100"],
                    ["A", "80–89"],
                    ["B", "70–79"],
                    ["C", "60–69"],
                    ["D", "50–59"],
                    ["E", "40–49"],
                    ["F", "30–39"],
                    ["G", "20–29"],
                    ["U", "0–19"],
                  ].map(([grade, range]) => (
                    <div
                      key={grade}
                      className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-center"
                    >
                      <p className="text-lg font-bold text-slate-900">
                        {grade}
                      </p>

                      <p className="mt-1 text-xs text-slate-500">{range}%</p>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}
        </div>
      ) : (
        <Card className="p-12">
          <div className="mx-auto max-w-md text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50">
              <User className="h-7 w-7 text-indigo-600" />
            </div>

            <h2 className="mt-4 text-base font-semibold text-slate-900">
              Select a student
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Choose a student above to view their academic results.
            </p>
          </div>
        </Card>
      )}
      </div>

      {printing && selectedStudent
        ? createPortal(
            <PrintableReportCard
              schoolName={school?.name ?? "School"}
              schoolSlug={school?.slug ?? ""}
              schoolLogoUrl={school?.logo_url ?? null}
              schoolAddress={school?.address ?? null}
              schoolCity={school?.city ?? null}
              schoolCountry={school?.country ?? null}
              schoolPhone={school?.phone ?? null}
              schoolEmail={school?.email ?? null}
              templateKey={resolveConfiguredTemplateKey(
                databaseReportTemplate?.template_key,
                school?.name,
                school?.slug,
                isNurseryStudent,
              )}
              student={selectedStudent}
              academicYear={selectedAcademicYear}
              term={selectedTerm}
              className={selectedStudent.className}
              subjectResults={subjectResults}
              overallAverage={summary.overallAverage}
              overallGrade={summary.overallGrade}
              reportSchemeId={reportSchemeId}
              assessmentCategories={reportAssessmentCategories}
              gradingScale={reportGradingScale}
              gradingScalesBySchemeId={gradingScalesBySchemeId}
              schemeMethodsById={schemeMethodsById}
              calculationMethod={reportCalculationMethod}
              classTeacherName={classTeacherName}
              classTeacherSignatureUrl={classTeacherSignatureUrl}
              principalName={principalName}
              principalSignatureUrl={principalSignatureUrl}
              nursery={isNurseryStudent}
            />,
            document.body,
          )
        : null}
    </>
  );
}

/* =========================================================
   PRINTABLE REPORT CARD
========================================================= */

function HighGateLogo({
  width = 180,
}: {
  width?: number;
}) {
  return (
    <img
      src="/high-gate-logo.png"
      alt="High Gate International Academy"
      loading="eager"
      decoding="sync"
      style={{
        display: "block",
        width: `${width}px`,
        height: "auto",
        maxWidth: "100%",
        objectFit: "contain",
      }}
    />
  );
}

type PrintReportProps = {
  schoolName: string;
  schoolSlug: string;
  schoolLogoUrl: string | null;
  schoolAddress: string | null;
  schoolCity: string | null;
  schoolCountry: string | null;
  schoolPhone: string | null;
  schoolEmail: string | null;
  templateKey: ReportCardTemplateKey;
  student: Student;
  academicYear: AcademicYear | null;
  term: Term;
  className: string;
  subjectResults: SubjectResult[];
  overallAverage: number | null;
  overallGrade: string;
  reportSchemeId: string | null;
  assessmentCategories: AssessmentCategory[];
  gradingScale: GradingBand[];
  gradingScalesBySchemeId: Record<string, GradingBand[]>;
  schemeMethodsById: Record<string, CalculationMethod>;
  calculationMethod: CalculationMethod | null;
  classTeacherName: string;
  classTeacherSignatureUrl: string;
  principalName: string;
  principalSignatureUrl: string;
};

function PrintableReportCard(
  props: PrintReportProps & { nursery: boolean },
) {
  const {
    schoolName,
    schoolLogoUrl,
    schoolAddress,
    schoolCity,
    schoolCountry,
    schoolPhone,
    schoolEmail,
    templateKey,
    student,
    academicYear,
    term,
    className,
    subjectResults,
    overallAverage,
    overallGrade,
    reportSchemeId,
    assessmentCategories,
    gradingScale,
    gradingScalesBySchemeId,
    schemeMethodsById,
    calculationMethod,
    classTeacherName,
    classTeacherSignatureUrl,
    principalName,
    principalSignatureUrl,
    nursery,
  } = props;
  const isHighGateNursery = templateKey === "high-gate-nursery-v1";
  const isHighGatePrimary = templateKey === "high-gate-primary-v1";
  const pageOrientation = isHighGateNursery ? "portrait" : "landscape";

  if (!isHighGateNursery && !isHighGatePrimary) {
    return (
      <div id="schoolos-report-card-print">
        <style>{getGenericReportPrintStyles(pageOrientation)}</style>
        <StandardPrintableReport
          schoolName={schoolName}
          schoolLogoUrl={schoolLogoUrl}
          schoolAddress={schoolAddress}
          schoolCity={schoolCity}
          schoolCountry={schoolCountry}
          schoolPhone={schoolPhone}
          schoolEmail={schoolEmail}
          student={student}
          academicYear={academicYear}
          term={term}
          className={className}
          subjectResults={subjectResults}
          overallAverage={overallAverage}
          overallGrade={overallGrade}
          classTeacherName={classTeacherName}
          classTeacherSignatureUrl={classTeacherSignatureUrl}
          principalName={principalName}
          principalSignatureUrl={principalSignatureUrl}
        />
      </div>
    );
  }

  return (
    <div id="schoolos-report-card-print">
      <style>
        {`
          @media screen {
            #schoolos-report-card-print {
              display: none !important;
            }
          }

          @media print {
            @page {
              size: A4 ${pageOrientation};
              margin: ${isHighGateNursery ? "6mm" : "4mm"};
            }

            html,
            body {
              margin: 0 !important;
              padding: 0 !important;
              width: 100% !important;
              min-height: 0 !important;
              height: auto !important;
              background: #fff !important;
            }

            body > #root {
              display: none !important;
            }

            body > #schoolos-report-card-print {
              display: block !important;
              position: static !important;
              width: 100% !important;
              min-height: 0 !important;
              height: auto !important;
              background: #fff !important;
              color: #111 !important;
            }

            #schoolos-report-card-print {
              font-family: "Times New Roman", Times, serif !important;
              font-size: 11px !important;
              line-height: 1.25 !important;
            }

            /* Increase small utility-sized text on the High Gate form only. */
            .hg-primary-flow .text-\[8\.5px\] {
              font-size: 10.5px !important;
              line-height: 1.25 !important;
            }
            .hg-primary-flow .text-\[8px\] {
              font-size: 10px !important;
              line-height: 1.25 !important;
            }
            .hg-primary-flow .text-\[7\.5px\] {
              font-size: 9.5px !important;
              line-height: 1.25 !important;
            }

            #schoolos-report-card-print * {
              visibility: visible !important;
              box-shadow: none !important;
            }

            .hg-page {
              page-break-after: always !important;
              break-after: page !important;
              min-height: 282mm !important;
              overflow: hidden !important;
            }

            .hg-page:last-child {
              page-break-after: auto !important;
              break-after: auto !important;
            }

            /*
             * High Gate Primary is a continuous landscape document.
             * Chrome paginates overflow and repeats the subject table header.
             */
            .hg-primary-flow {
              width: 100% !important;
            }

            .hg-primary-flow .hg-primary-table {
              width: 100% !important;
              border-collapse: collapse !important;
              table-layout: fixed !important;
            }

            .hg-primary-flow .hg-primary-table thead {
              display: table-header-group !important;
            }

            .hg-primary-flow .hg-primary-table tr {
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }

            .hg-primary-flow .hg-primary-table th,
            .hg-primary-flow .hg-primary-table td {
              border: 1px solid #111 !important;
              padding: 4px 3px !important;
              vertical-align: middle !important;
            }

            .hg-primary-flow .hg-primary-table th {
              background: #c4df91 !important;
              font-size: 11px !important;
              line-height: 1.2 !important;
            }

            .hg-primary-flow .hg-primary-table td {
              font-size: 10.8px !important;
              line-height: 1.25 !important;
            }

            .hg-primary-flow .hg-primary-comment {
              font-size: 10px !important;
              line-height: 1.25 !important;
              overflow-wrap: anywhere !important;
            }

            .hg-primary-flow .hg-primary-teacher {
              font-size: 10px !important;
              line-height: 1.25 !important;
            }

            .hg-primary-flow .hg-primary-summary-block {
              break-inside: avoid !important;
              page-break-inside: avoid !important;
            }
            .hg-primary-flow .hg-primary-summary-block .text-\[7\.5px\],
            .hg-primary-flow .hg-primary-summary-block .text-\[8px\],
            .hg-primary-flow .hg-primary-summary-block .text-\[8\.5px\],
            .hg-primary-flow .hg-primary-summary-block .text-\[9px\] {
              font-size: 9.5px !important;
              line-height: 1.25 !important;
            }
          }
        `}
      </style>

      {nursery ? (
        <NurseryPrintableReport
          schoolName={schoolName}
          student={student}
          academicYear={academicYear}
          term={term}
          className={className}
          classTeacherName={classTeacherName}
          classTeacherSignatureUrl={classTeacherSignatureUrl}
          principalName={principalName}
          principalSignatureUrl={principalSignatureUrl}
        />
      ) : (
        <PrimaryPrintableReport
          student={student}
          academicYear={academicYear}
          term={term}
          className={className}
          subjectResults={subjectResults}
          overallAverage={overallAverage}
          overallGrade={overallGrade}
          reportSchemeId={reportSchemeId}
          assessmentCategories={assessmentCategories}
          gradingScale={gradingScale}
          gradingScalesBySchemeId={gradingScalesBySchemeId}
          schemeMethodsById={schemeMethodsById}
          calculationMethod={calculationMethod}
          classTeacherName={classTeacherName}
          classTeacherSignatureUrl={classTeacherSignatureUrl}
          principalName={principalName}
          principalSignatureUrl={principalSignatureUrl}
        />
            )}
    </div>
  );
}


function getGenericReportPrintStyles(orientation: "portrait" | "landscape") {
  return `
    @media screen {
      #schoolos-report-card-print { display: none !important; }
    }
    @media print {
      @page { size: A4 ${orientation}; margin: 7mm; }
      html, body {
        margin: 0 !important; padding: 0 !important; width: 100% !important;
        min-height: 0 !important; height: auto !important; background: #fff !important;
      }
      body > #root { display: none !important; }
      body > #schoolos-report-card-print {
        display: block !important; position: static !important;
        width: 100% !important; min-height: 0 !important; height: auto !important;
        background: #fff !important; color: #111 !important;
      }
      #schoolos-report-card-print {
        font-family: Arial, Helvetica, sans-serif !important;
        font-size: 11px !important; color: #111 !important;
      }
      #schoolos-report-card-print header h1 { font-size: 20px !important; line-height: 1.2 !important; }
      #schoolos-report-card-print header h2 { font-size: 16px !important; line-height: 1.2 !important; }
      #schoolos-report-card-print section { font-size: 11px !important; line-height: 1.35 !important; }
      #schoolos-report-card-print * {
        visibility: visible !important; box-shadow: none !important;
        box-sizing: border-box !important;
      }
      .ms-standard-report-table {
        width: 100% !important; border-collapse: collapse !important;
        table-layout: fixed !important;
      }
      .ms-standard-report-table thead { display: table-header-group !important; }
      .ms-standard-report-table tr {
        break-inside: avoid !important; page-break-inside: avoid !important;
      }
      .ms-standard-report-table th, .ms-standard-report-table td {
        border: 1px solid #333 !important; padding: 5px !important;
        vertical-align: top !important; overflow-wrap: anywhere !important;
        font-size: 12px !important; line-height: 1.3 !important;
      }
      .ms-standard-report-table th {
        background: #e9eef5 !important; font-weight: 700 !important; font-size: 12.5px !important;
      }
      .ms-standard-footer-block { font-size: 12px !important; line-height: 1.4 !important; }
      .ms-standard-footer-block { break-inside: avoid !important; page-break-inside: avoid !important; }
    }
  `;
}

type StandardPrintableReportProps = Omit<
  PrintReportProps,
  | "schoolSlug"
  | "templateKey"
  | "reportSchemeId"
  | "assessmentCategories"
  | "gradingScale"
  | "gradingScalesBySchemeId"
  | "schemeMethodsById"
  | "calculationMethod"
>;

function StandardPrintableReport({
  schoolName,
  schoolLogoUrl,
  schoolAddress,
  schoolCity,
  schoolCountry,
  schoolPhone,
  schoolEmail,
  student,
  academicYear,
  term,
  className,
  subjectResults,
  overallAverage,
  classTeacherName,
  classTeacherSignatureUrl,
  principalName,
  principalSignatureUrl,
}: StandardPrintableReportProps) {
  return (
    <div className="mx-auto w-full bg-white px-1 py-1 text-slate-900">
      <header className="mb-4 flex items-center justify-between gap-4 border-b-2 border-slate-800 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          {schoolLogoUrl ? (
            <img
              src={schoolLogoUrl}
              alt={`${schoolName} logo`}
              loading="eager"
              decoding="sync"
              className="max-h-20 max-w-24 object-contain"
            />
          ) : null}
          <div className="min-w-0">
            <h1 className="text-lg font-bold">{schoolName}</h1>
            {[schoolAddress, [schoolCity, schoolCountry].filter(Boolean).join(", ")]
              .filter(Boolean)
              .map((line) => (
                <p key={line} className="mt-0.5 text-[11px] text-slate-600">{line}</p>
              ))}
            {[schoolPhone, schoolEmail].filter(Boolean).length > 0 ? (
              <p className="mt-0.5 text-[11px] text-slate-600">
                {[schoolPhone, schoolEmail].filter(Boolean).join(" · ")}
              </p>
            ) : null}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <h2 className="text-base font-bold">STUDENT TERM REPORT</h2>
          <p className="mt-1 text-[11px]">{academicYear?.name ?? "—"} · {term}</p>
        </div>
      </header>

      <section className="mb-3 grid grid-cols-2 gap-x-8 gap-y-2 text-[11px]">
        <p><strong>Student:</strong> {student.name}</p>
        <p><strong>Class:</strong> {className || "—"}</p>
        <p><strong>Registration number:</strong> {student.studentId}</p>
        <p><strong>Academic year:</strong> {academicYear?.name ?? "—"}</p>
      </section>

      <table className="ms-standard-report-table">
        <colgroup>
          <col style={{ width: "18%" }} />
          <col style={{ width: "34%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "28%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>Subject</th>
            <th>Assessment results</th>
            <th>Average</th>
            <th>Teacher</th>
            <th>Teacher comments</th>
          </tr>
        </thead>
        <tbody>
          {subjectResults.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-8 text-center">
                No published assessment results are available for this term.
              </td>
            </tr>
          ) : subjectResults.map((subject) => {
            const comment = subject.assessments.find((assessment) => assessment.remarks?.trim())?.remarks ?? "";
            return (
              <tr key={subject.subjectId}>
                <td className="font-semibold">{subject.subjectName}</td>
                <td>
                  {subject.assessments.map((assessment) => (
                    <span key={assessment.id} className="mr-2 inline-block">
                      {assessment.type}: {assessment.marks ?? "—"}/{assessment.maxMarks}
                    </span>
                  ))}
                </td>
                <td>
                  {subject.average === null ? "—" : `${subject.average.toFixed(1)}%`}
                </td>
                <td>{subject.teacherName || "—"}</td>
                <td>{comment || "—"}</td>
              </tr>
            );
          })}
          {subjectResults.length > 0 ? (
            <tr>
              <td colSpan={2} className="font-bold">Overall average</td>
              <td colSpan={3} className="font-bold">
                {overallAverage === null ? "—" : `${overallAverage.toFixed(2)}%`}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="ms-standard-footer-block mt-5 grid grid-cols-2 gap-8 text-[11px]">
        <div>
          <div className="mb-2 font-semibold">Class teacher</div>
          <div className="mb-1 font-semibold">{classTeacherName || "________________"}</div>
          <div className="mb-1 flex h-10 items-end">
            {classTeacherSignatureUrl ? (
              <img src={classTeacherSignatureUrl} alt="Class teacher signature" className="max-h-10 max-w-40 object-contain object-left-bottom" />
            ) : null}
          </div>
          <div className="border-b border-slate-500 pb-1">Signature / Date: __________________</div>
        </div>
        <div>
          <div className="mb-1 font-semibold">Principal</div>
          <div className="mb-1 font-semibold">{principalName || "________________"}</div>
          <div className="mb-1 flex h-10 items-end">
            {principalSignatureUrl ? (
              <img src={principalSignatureUrl} alt="Principal signature" className="max-h-10 max-w-40 object-contain object-left-bottom" />
            ) : null}
          </div>
          <div className="border-b border-slate-500 pb-1">Signature</div>
          <div className="mt-1">Date: __________________</div>
        </div>
      </div>
      <p className="mt-4 text-center text-[10px] text-slate-500">
        This is the standard MojaSchool report template. A school-specific report design can be configured when provided by the school.
      </p>
    </div>
  );
}

type PrimaryPrintableReportProps = Pick<
  PrintReportProps,
  | "student"
  | "academicYear"
  | "term"
  | "className"
  | "subjectResults"
  | "overallAverage"
  | "overallGrade"
  | "reportSchemeId"
  | "assessmentCategories"
  | "gradingScale"
  | "gradingScalesBySchemeId"
  | "schemeMethodsById"
  | "calculationMethod"
  | "classTeacherName"
  | "classTeacherSignatureUrl"
  | "principalName"
  | "principalSignatureUrl"
>;

function PrimaryPrintableReport({
  student,
  academicYear,
  term,
  className,
  subjectResults,
  overallAverage,
  reportSchemeId,
  assessmentCategories,
  gradingScale,
  gradingScalesBySchemeId,
  schemeMethodsById,
  calculationMethod,
  classTeacherName,
  classTeacherSignatureUrl,
  principalName,
  principalSignatureUrl,
}: PrimaryPrintableReportProps) {
  const fallbackColumns = [
    { categoryId: null, categoryKey: "cat_i", label: "CAT I", maxMarks: 40, fallbackType: "CAT I" },
    { categoryId: null, categoryKey: "cat_ii", label: "CAT II", maxMarks: 40, fallbackType: "CAT II" },
    { categoryId: null, categoryKey: "class_participation", label: "C.P", maxMarks: 10, fallbackType: "C.P" },
    { categoryId: null, categoryKey: "homework_projects", label: "HW&Pr", maxMarks: 10, fallbackType: "HW&Pr" },
    { categoryId: null, categoryKey: "exam", label: "Exam", maxMarks: 100, fallbackType: "Exam" },
  ];
  // The installed High Gate template keeps its familiar table format, but the
  // actual category labels/maxima come from the configured scheme version.
  const configuredColumns = assessmentCategories
    .filter((category) => category.enabled && (!reportSchemeId || category.scheme_id === reportSchemeId))
    .sort((left, right) => left.display_order - right.display_order)
    .map((category) => ({
      categoryId: category.id,
      categoryKey: category.category_key,
      label: category.label,
      maxMarks: Number(category.max_marks),
      fallbackType: category.label,
    }));
  const columns = configuredColumns.length > 0 ? configuredColumns : fallbackColumns;

  const getMark = (
    subject: SubjectResult,
    column: (typeof columns)[number],
  ): number | null => {
    const match = subject.assessments.find((assessment) => {
      if (column.categoryId && assessment.categoryId === column.categoryId) return true;
      return normalizedAssessmentKey(assessment.categoryKey) === normalizedAssessmentKey(column.categoryKey) ||
        normalizedAssessmentKey(assessment.type) === normalizedAssessmentKey(column.label) ||
        normalizedAssessmentKey(assessment.type) === normalizedAssessmentKey(column.fallbackType);
    });
    return match?.marks ?? null;
  };

  const getSubjectSchemeId = (subject: SubjectResult): string | null => {
    const ids = Array.from(new Set(subject.assessments.map((item) => item.schemeId).filter((id): id is string => Boolean(id))));
    if (ids.length === 1) return ids[0];
    if (ids.length === 0) return reportSchemeId;
    return null;
  };

  const getSubjectGradingScale = (subject: SubjectResult): GradingBand[] => {
    const schemeId = getSubjectSchemeId(subject);
    return schemeId ? (gradingScalesBySchemeId[schemeId] ?? gradingScale) : gradingScale;
  };

  const getTotal = (subject: SubjectResult): number | null => {
    const subjectSchemeIds = Array.from(new Set(subject.assessments.map((item) => item.schemeId).filter((id): id is string => Boolean(id))));
    if (subjectSchemeIds.length > 1) return subject.average;
    const schemeId = getSubjectSchemeId(subject);
    const subjectCalculationMethod = schemeId
      ? schemeMethodsById[schemeId] ?? calculationMethod
      : calculationMethod;
    if (subjectCalculationMethod !== "total_to_percentage") return subject.average;

    const categoriesForSubject = assessmentCategories.filter((category) =>
      category.enabled && category.contributes_to_total && (!schemeId || category.scheme_id === schemeId),
    );
    if (categoriesForSubject.length === 0) return subject.average;
    const hasMissingRequired = categoriesForSubject.some((category) =>
      category.is_required && !subject.assessments.some((assessment) => {
        if (assessment.marks === null) return false;
        if (assessment.categoryId) return assessment.categoryId === category.id;
        return assessment.categoryKey === category.category_key ||
          normalizedAssessmentKey(assessment.type) === normalizedAssessmentKey(category.label) ||
          normalizedAssessmentKey(assessment.type) === normalizedAssessmentKey(category.category_key);
      }),
    );
    if (hasMissingRequired) return null;

    let earnedEquivalent = 0;
    let possibleEquivalent = 0;
    for (const category of categoriesForSubject) {
      const matching = subject.assessments.filter((assessment) => {
        if (assessment.categoryId) return assessment.categoryId === category.id;
        return assessment.categoryKey === category.category_key ||
          normalizedAssessmentKey(assessment.type) === normalizedAssessmentKey(category.label) ||
          normalizedAssessmentKey(assessment.type) === normalizedAssessmentKey(category.category_key);
      }).filter((assessment) => assessment.marks !== null);
      if (matching.length === 0) continue;
      const percentage = matching.reduce((total, item) => total + Number(item.percentage ?? 0), 0) / matching.length;
      earnedEquivalent += (percentage / 100) * Number(category.max_marks);
      possibleEquivalent += Number(category.max_marks);
    }
    return possibleEquivalent > 0 ? (earnedEquivalent / possibleEquivalent) * 100 : subject.average;
  };

  return (
    <div className="hg-primary-flow">
      {/* =====================================================
          HIGH GATE PRIMARY REPORT — ONE CONTINUOUS DOCUMENT
          The browser creates page 2 only when page 1 is full.
      ===================================================== */}

      <div className="grid grid-cols-[105px_1fr_82px] items-start gap-3">
        <div className="pt-0.5">
          <HighGateLogo width={100} />
        </div>

        <div className="pt-1 text-center text-[8px] leading-3.5">
          <div>
            Tel : + 250 79 89 80 340
          </div>
          <div>
            Website : www.highgateinternational.com
          </div>
          <div>
            E-mail : info@highgateinternational.com
          </div>
        </div>

        <div className="flex justify-end pt-1">
          <img
            src="/educanada-logo.png"
            alt="EduCanada"
            loading="eager"
            decoding="sync"
            style={{
              display: "block",
              width: "68px",
              height: "auto",
              objectFit: "contain",
            }}
          />
        </div>
      </div>

      <div className="mt-2 border-b-2 border-black pb-2 text-center">
        <div className="text-[16px] font-bold">
          STUDENT TERMLY REPORT
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-8 gap-y-1 text-[8.5px]">
        <div>
          <strong>NAME:</strong>{" "}
          {student.name}
        </div>

        <div>
          <strong>CLASS:</strong>{" "}
          {className || "—"}
        </div>

        <div>
          <strong>REG. NO.:</strong>{" "}
          {student.studentId}
        </div>

        <div>
          <strong>YEAR :</strong>{" "}
          {academicYear?.name || "—"} -{" "}
          <strong>TERM:</strong>{" "}
          {term.replace("Term ", "")}
        </div>
      </div>

      <table className="hg-primary-table mt-3">
        <colgroup>
          <col style={{ width: "15%" }} />
          {columns.map((column) => <col key={column.categoryId ?? column.categoryKey} style={{ width: `${40 / (columns.length + 3)}%` }} />)}
          <col style={{ width: `${40 / (columns.length + 3)}%` }} />
          <col style={{ width: `${40 / (columns.length + 3)}%` }} />
          <col style={{ width: `${40 / (columns.length + 3)}%` }} />
          <col style={{ width: "35%" }} />
          <col style={{ width: "10%" }} />
        </colgroup>

        <thead>
          <tr>
            <th>SUBJECT</th>

            {columns.map((column) => (
              <th key={column.categoryId ?? column.categoryKey} className="text-center">
                <div>{column.label}</div>
                <div className="font-normal">/{column.maxMarks}</div>
              </th>
            ))}

            <th className="text-center">
              <div>TOT</div>
              <div className="font-normal">
                /100
              </div>
            </th>

            <th className="text-center">
              GR
            </th>

            <th className="text-center">
              CA
            </th>

            <th>COMMENT</th>
            <th>TEACHER</th>
          </tr>
        </thead>

        <tbody>
          {subjectResults.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + 6}
                className="py-8 text-center"
              >
                No assessment results available.
              </td>
            </tr>
          ) : (
            subjectResults.map((subject) => {
              const total = getTotal(subject);

              const comment =
                subject.assessments.find(
                  (assessment) =>
                    assessment.remarks?.trim(),
                )?.remarks ?? "";

              return (
                <tr
                  key={subject.subjectId}
                  className="hg-no-break"
                >
                  <td className="font-bold italic">
                    {subject.subjectName}
                  </td>

                  {columns.map((column) => (
                    <td key={column.categoryId ?? column.categoryKey} className="text-center">
                      {getMark(subject, column) ?? ""}
                    </td>
                  ))}

                  <td className="text-center font-bold">
                    {total !== null
                      ? Math.round(total)
                      : ""}
                  </td>

                  <td className="text-center font-bold">
                    {getConfiguredGrade(total, getSubjectGradingScale(subject))}
                  </td>

                  <td className="text-center">
                    {subject.classAverage !== null
                      ? Math.round(subject.classAverage)
                      : ""}
                  </td>

                  <td className="hg-primary-comment">
                    {comment}
                  </td>

                  <td className="hg-primary-teacher">
                    {subject.teacherName || "—"}
                  </td>
                </tr>
              );
            })
          )}

          {subjectResults.length > 0 && (
            <tr className="hg-green">
              <td className="font-bold italic">AVERAGE</td>
              <td
                colSpan={columns.length + 1}
                className="text-center font-bold"
              >
                {overallAverage !== null
                  ? `${overallAverage.toFixed(2)}%`
                  : "—"}
              </td>
              <td colSpan={4} />
            </tr>
          )}
        </tbody>
      </table>

      <div className="hg-primary-summary-block mt-2 text-[8.5px] font-bold">
        Conduct : _____ / 40
      </div>

      <div className="hg-primary-summary-block mt-2 border-2 border-black">
        <div className="bg-slate-100 px-2 py-1 text-center text-[9px] font-bold">
          General Comment
        </div>

        <div className="min-h-[60px] px-4 py-3 text-[8.5px]">
          &nbsp;
        </div>
      </div>

      <div className="hg-primary-summary-block mt-3 text-[7.5px] leading-3">
        <div className="font-bold">
          ABBREVIATIONS
        </div>

        <div className="mt-1 grid grid-cols-3 gap-x-5 gap-y-1">
          <div>
            <strong>CAT_I</strong> : CAT (Test 1, Mid term 1)
          </div>

          <div>
            <strong>CAT_II</strong> : CAT (Test 2, Mid term 2)
          </div>

          <div>
            <strong>C.P</strong> : Class Participation
          </div>

          <div>
            <strong>Exam</strong> : End of Term Exam
          </div>

          <div>
            <strong>TOT</strong> : Total
          </div>

          <div>
            <strong>HW&amp;Pr</strong> : Home Work &amp; Projects
          </div>

          <div>
            <strong>GR</strong> : Grade
          </div>

          <div>
            <strong>CA</strong> : Class Average
          </div>
        </div>
      </div>

      <div className="hg-primary-summary-block mt-3">
        <div className="font-bold text-[8.5px]">
          Grading Scale
        </div>

        <table className="hg-primary-table mt-1 text-[7.5px]">
          <tbody>
            <tr>
              {(gradingScale.length > 0
                ? [...gradingScale]
                    .sort((a, b) => Number(b.min_percentage) - Number(a.min_percentage))
                    .map((band) => [
                      `${Math.ceil(Number(band.min_percentage))}-${Math.floor(Number(band.max_percentage))}`,
                      band.grade,
                    ] as [string, string])
                : [["90-100", "A*"], ["80-89", "A"], ["70-79", "B"], ["60-69", "C"], ["50-59", "D"], ["40-49", "E"], ["30-39", "F"], ["20-29", "G"], ["0-19", "U"]] as [string, string][]
              ).map(([range, grade]) => (
                <td key={grade} className="py-1 text-center">
                  <div>{range}</div>
                  <div className="font-bold">{grade}</div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="hg-primary-summary-block mt-4 grid grid-cols-2 gap-20 text-[9px]">
        <div>
          <div className="font-semibold">
            Class Teacher
          </div>

          <div className="mt-1 font-semibold">
            {classTeacherName || "________________"}
          </div>
          <div className="mt-1 flex h-10 items-end">
            {classTeacherSignatureUrl ? (
              <img src={classTeacherSignatureUrl} alt="Class teacher signature" className="max-h-10 max-w-40 object-contain object-left-bottom" />
            ) : null}
          </div>
          <div className="mt-1 border-t border-black pt-1">
            Signature
          </div>
        </div>

        <div>
          <div className="font-semibold">Principal</div>
          <div className="mt-1 min-h-4 font-semibold">
            {principalName || "________________"}
          </div>
          <div className="mt-1 flex h-10 items-end">
            {principalSignatureUrl ? (
              <img src={principalSignatureUrl} alt="Principal signature" className="max-h-10 max-w-40 object-contain object-left-bottom" />
            ) : null}
          </div>
          <div className="mt-1 border-t border-black pt-1">Signature</div>
        </div>
      </div>

      <div className="hg-primary-summary-block mt-5 flex justify-center">
        <div className="text-center text-[8px]">
          <div className="font-bold">
            Cambridge Assessment
          </div>
          <div>
            International Education
          </div>
          <div className="mt-1">
            Cambridge International School
          </div>
        </div>
      </div>

      <div className="mt-3 text-center text-[8px]">
        School Contacts: Website: www.highgateinternational.com /
        Email: info@highgateinternational.com / Phone number: + 250 79 89 80 340 /
        Report made using www.academicbridge.xyz
      </div>
    </div>
  );
}

function NurseryPrintableReport({
  student,
  academicYear,
  term,
  className,
  classTeacherName,
  classTeacherSignatureUrl,
  principalName,
  principalSignatureUrl,
}: {
  schoolName: string;
  student: Student;
  academicYear: AcademicYear | null;
  term: Term;
  className: string;
  classTeacherName: string;
  classTeacherSignatureUrl: string;
  principalName: string;
  principalSignatureUrl: string;
}) {
  const pages = [
    [
      {
        domain: "Domaine Langagier",
        competency: "ECRITURE",
        titleColor: "#89D0F0",
        status:
          "Votre enfant se développe avec certaines difficultés au regard de la compétence visée",
        statusColor: "#FFAA00",
        commentColor: "#DDEFFC",
      },
      {
        domain: "Domaine Langagier",
        competency: "EXPRESSION ORALE",
        titleColor: "#8BC58B",
        status:
          "Votre enfant se développe bien au regard de la compétence visée",
        statusColor: "#FFFF00",
        commentColor: "#DCF0DC",
      },
      {
        domain: "Domaine Langagier",
        competency: "LECTURE",
        titleColor: "#FF738D",
        status:
          "Votre enfant se développe très bien au regard de la compétence visée",
        statusColor: "#008001",
        commentColor: "#FFE0E7",
      },
      {
        domain: "Domaine Cognitif",
        competency: "COMPTAGE",
        titleColor: "#8F4FA6",
        status:
          "Votre enfant se développe très bien au regard de la compétence visée",
        statusColor: "#008001",
        commentColor: "#E4D8EA",
      },
    ],
    [
      {
        domain: "Domaine Cognitif",
        competency: "JEUX A MATHIS",
        titleColor: "#89D0F0",
        status:
          "Votre enfant se développe très bien au regard de la compétence visée",
        statusColor: "#008001",
        commentColor: "#DDEFFC",
      },
      {
        domain: "Domaine Physique Moteur",
        competency: "ACTIVITE DE MOTRICITE FINE",
        titleColor: "#8BC58B",
        status:
          "Votre enfant se développe très bien au regard de la compétence visée",
        statusColor: "#008001",
        commentColor: "#DCF0DC",
      },
      {
        domain: "Domaine Physique Moteur",
        competency: "JEU DE MOTRICITE GLOBALE",
        titleColor: "#FF738D",
        status:
          "Votre enfant se développe très bien au regard de la compétence visée",
        statusColor: "#008001",
        commentColor: "#FFE0E7",
      },
      {
        domain: "Domaine Sociale",
        competency: "CONVIVIALITE",
        titleColor: "#8F4FA6",
        status:
          "Votre enfant se développe très bien au regard de la compétence visée",
        statusColor: "#008001",
        commentColor: "#E4D8EA",
      },
    ],
    [
      {
        domain: "Domaine Sociale",
        competency: "Sociabilité",
        titleColor: "#89D0F0",
        status:
          "Votre enfant se développe très bien au regard de la compétence visée",
        statusColor: "#008001",
        commentColor: "#DDEFFC",
      },
      {
        domain: "Domaine Affectif",
        competency: "CONNAISSANCE DE SOI",
        titleColor: "#8BC58B",
        status:
          "Votre enfant se développe très bien au regard de la compétence visée",
        statusColor: "#008001",
        commentColor: "#DCF0DC",
      },
    ],
  ];

  function renderCompetency(
    item: (typeof pages)[number][number],
  ) {
    return (
      <div
        key={`${item.domain}-${item.competency}`}
        className="hg-no-break"
      >
        <div className="grid grid-cols-[165px_1fr] gap-3">
          <div className="flex items-center justify-center">
            <div
              className="flex h-[112px] w-[112px] items-center justify-center rounded-full px-4 text-center text-[10px] leading-tight"
              style={{ backgroundColor: item.titleColor }}
            >
              {item.domain}
            </div>
          </div>

          <div>
            <div
              className="flex min-h-[78px] items-center px-4 text-[13px]"
              style={{ backgroundColor: item.titleColor }}
            >
              {item.competency}
            </div>

            <div
              className="mt-1 flex min-h-[58px] items-center px-4 text-[10px]"
              style={{ backgroundColor: item.statusColor }}
            >
              {item.status}
            </div>
          </div>
        </div>

        <div
          className="mt-1 px-4 py-2 text-[9.2px] leading-tight"
          style={{ backgroundColor: item.commentColor }}
        >
          <strong className="italic">Comment :</strong>
          {" "}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* PAGE 1 */}
      <div className="hg-page px-1.5 py-1">
        <div
          className="hg-blue"
          style={{
            width: "100%",
            minHeight: "180px",
            boxSizing: "border-box",
            backgroundColor: "#064b63",
            color: "#ffffff",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: "20px 28px",
          }}
        >
          <div
            style={{
              color: "#ffffff",
              fontFamily: '"Times New Roman", Times, serif',
              fontSize: "28px",
              lineHeight: "1.15",
              fontWeight: 700,
              fontStyle: "italic",
              whiteSpace: "nowrap",
            }}
          >
            BULLETIN DE L'ÉDUCATION PRÉSCOLAIRE
          </div>

          <div
            style={{
              color: "#ffffff",
              marginTop: "28px",
              fontFamily: '"Times New Roman", Times, serif',
              fontSize: "24px",
              lineHeight: "1.15",
              fontWeight: 700,
              fontStyle: "italic",
              whiteSpace: "nowrap",
            }}
          >
            ANNÉE SCOLAIRE {academicYear?.name ?? "—"}
          </div>
        </div>

        <div className="mt-4 flex justify-center">
          <HighGateLogo width={370} />
        </div>

        <div className="mt-1 text-center text-[10px] leading-4">
          <div>KG 669 St Gasabo District, Gisozi Sector</div>
          <div>
            + 250 79 89 80 340 &nbsp;&nbsp;
            www.highgateinternational.com &nbsp;&nbsp;
            Email : info@highgateinternational.com
          </div>
        </div>

        <div
          className="mt-2 h-[6px]"
          style={{ backgroundColor: "#064b63" }}
        />

        <div className="mt-3 space-y-1 text-[11px]">
          <div className="grid grid-cols-[180px_1fr] border-b border-slate-300 pb-1">
            <span>Nom de l'enfant :</span>
            <strong className="italic">{student.name}</strong>
          </div>

          <div className="grid grid-cols-[180px_1fr] border-b border-slate-300 pb-1">
            <span>Date de naissance :</span>
            <span>{formatDate(student.dateOfBirth)}</span>
          </div>

          <div className="grid grid-cols-[180px_1fr] border-b border-slate-300 pb-1">
            <span>Numéro matricule :</span>
            <span>{student.studentId}</span>
          </div>

          <div className="grid grid-cols-[180px_1fr] border-b border-slate-300 pb-1">
            <span>Classe :</span>
            <span>{className || "—"}</span>
          </div>
        </div>

        <div className="mt-4 text-[10px]">
          <div className="font-bold italic">
            DESTINATAIRE(S) DU BULLETIN
          </div>

          <div className="mt-2">
            Père ☐ &nbsp;&nbsp; Mère ☐ &nbsp;&nbsp;
            Tutrice ou tuteur ☐ &nbsp;&nbsp; Autre ☐
          </div>

          <div className="mt-2 grid grid-cols-[100px_1fr] gap-y-2">
            <span>Adresse :</span>
            <span className="border-b border-slate-300" />

            <span>Numéro de téléphone :</span>
            <span className="border-b border-slate-300" />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-6 text-[10px]">
          <div>
            <div className="bg-[#C6D8E5] px-3 py-2">
              Directeur de l'école :
            </div>
            <div className="mt-2 min-h-5 font-semibold">{principalName || "________________"}</div>
            <div className="mt-1 flex h-10 items-end">
              {principalSignatureUrl ? (
                <img src={principalSignatureUrl} alt="Signature du directeur" className="max-h-10 max-w-40 object-contain object-left-bottom" />
              ) : null}
            </div>
            <div className="mt-1 border-b border-slate-400 pb-2">Signature:</div>
          </div>

          <div>
            <div className="bg-[#C6D8E5] px-3 py-2">
              Enseignante :
            </div>
            <div className="mt-2 min-h-5 font-semibold">{classTeacherName || "________________"}</div>
            <div className="mt-1 flex h-10 items-end">
              {classTeacherSignatureUrl ? (
                <img src={classTeacherSignatureUrl} alt="Class teacher signature" className="max-h-10 max-w-40 object-contain object-left-bottom" />
              ) : null}
            </div>
            <div className="mt-1 border-b border-slate-400 pb-2">Signature:</div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-[165px_1fr_1fr] items-center gap-5 text-[10px]">
          <div className="hg-blue px-3 py-3">
            Étape de la communication
          </div>

          <div className="border-b border-slate-400 pb-2">
            Début :
          </div>

          <div className="border-b border-slate-400 pb-2">
            Fin :
          </div>
        </div>

        <div className="mt-5 grid grid-cols-[0.72fr_1.45fr] items-end gap-5">
          <div className="flex justify-center">
            <div className="text-[70px] leading-none">👧</div>
          </div>

          <div>
            <div className="mb-1 text-[11px] font-bold italic">
              ASSIDUITÉ
            </div>

            <table className="hg-table text-[10px]">
              <tbody>
                <tr>
                  <td className="bg-[#C6D8E5] font-bold">
                    Trimestre
                  </td>

                  <td className="bg-[#C6D8E5] text-center font-bold">
                    {term.replace("Term ", "")}
                  </td>
                </tr>

                <tr>
                  <td>Jours d'absence</td>
                  <td className="text-center">—</td>
                </tr>

                <tr>
                  <td>Jours de classe</td>
                  <td className="text-center">—</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4">
          <div className="hg-blue px-3 py-2 text-[10px]">
            LÉGENDE
          </div>

          <div className="mt-1 space-y-1.5 text-[8.8px]">
            {[
              [
                "#008001",
                "Votre enfant se développe très bien au regard de la compétence visée",
              ],
              [
                "#FFFF00",
                "Votre enfant se développe bien au regard de la compétence visée",
              ],
              [
                "#FFAA00",
                "Votre enfant se développe avec certaines difficultés au regard de la compétence visée",
              ],
              [
                "#FF0000",
                "Votre enfant se développe avec des difficultés importantes au regard de la compétence visée",
              ],
            ].map(([color, label]) => (
              <div key={label} className="flex items-center gap-3">
                <span
                  className="inline-block h-5 w-32 shrink-0"
                  style={{ backgroundColor: color }}
                />

                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* PAGE 2 */}
      <div className="hg-page px-1.5 py-1">
        <div className="hg-blue px-5 py-4 text-center text-[19px] font-bold italic">
          ÉTAT DE DÉVELOPPEMENT DES COMPÉTENCES
        </div>

        <div className="mt-5 space-y-3">
          {pages[0].map(renderCompetency)}
        </div>
      </div>

      {/* PAGE 3 */}
      <div className="hg-page px-1.5 py-1">
        <div className="hg-blue px-5 py-4 text-center text-[19px] font-bold italic">
          ÉTAT DE DÉVELOPPEMENT DES COMPÉTENCES
        </div>

        <div className="mt-5 space-y-3">
          {pages[1].map(renderCompetency)}
        </div>
      </div>

      {/* PAGE 4 */}
      <div className="hg-page px-1.5 py-1">
        <div className="hg-blue px-5 py-4 text-center text-[19px] font-bold italic">
          ÉTAT DE DÉVELOPPEMENT DES COMPÉTENCES
        </div>

        <div className="mt-5 space-y-3">
          {pages[2].map(renderCompetency)}
        </div>

        <div className="mt-4 grid grid-cols-[1fr_125px] gap-4">
          <div className="border-2 border-black">
            <div className="border-b border-black px-2 py-1 text-center text-[12px] font-bold italic">
              Commentaire du titulaire de la classe
            </div>

            <div className="min-h-[145px] px-3 py-3 text-[9px]">
              &nbsp;
            </div>
          </div>

          <div className="flex items-start justify-center">
            <div className="h-[104px] w-[104px] border-2 border-black p-2 text-center text-[9px]">
              Scan for verification
            </div>
          </div>
        </div>

        <div className="mt-7 grid grid-cols-2 items-end gap-16 text-[10px]">
          <div>Signature et cachet:</div>

          <div className="text-right">
            <div className="mb-8 font-bold italic">
              ______________________
            </div>

            <div>Direction / École</div>
          </div>
        </div>

        <div className="mt-12 text-center text-[8px]">
          School Contacts: Website: www.highgateinternational.com /
          Email: info@highgateinternational.com /
          Phone number: + 250 79 89 80 340
        </div>
      </div>
    </>
  );
}

