import { supabase } from "./supabase";

export type CalculationMethod =
  | "total_to_percentage"
  | "weighted_average"
  | "average_percentages";

export interface AssessmentScheme {
  id: string;
  school_id: string;
  academic_year_id: string | null;
  academic_section_id: string | null;
  scheme_name: string;
  calculation_method: CalculationMethod;
  version_no: number;
  is_active: boolean;
}

export interface AssessmentCategory {
  id: string;
  scheme_id: string;
  category_key: string;
  label: string;
  max_marks: number;
  weight_percent: number | null;
  display_order: number;
  enabled: boolean;
  contributes_to_total: boolean;
  is_required: boolean;
}

export interface GradingBand {
  id: string;
  scheme_id: string;
  min_percentage: number;
  max_percentage: number;
  grade: string;
  description: string | null;
  display_order: number;
}

export interface SchoolReportCardTemplate {
  id: string;
  school_id: string;
  academic_year_id: string | null;
  academic_section_id: string | null;
  template_key: string;
  template_name: string;
  layout_config: Record<string, unknown>;
  version_no: number;
  is_active: boolean;
}

export interface AssessmentSchemeBundle {
  scheme: AssessmentScheme | null;
  categories: AssessmentCategory[];
  grades: GradingBand[];
}

/**
 * Resolve the most specific active scheme without crossing school boundaries.
 * A section-scoped scheme takes precedence over a year-only or school-wide
 * scheme; within that scope, a year-specific scheme takes precedence.
 */
export async function loadActiveAssessmentScheme(
  schoolId: string,
  academicYearId: string | null,
  academicSectionId: string | null,
): Promise<AssessmentSchemeBundle> {
  const { data: schemeRows, error: schemeError } = await supabase
    .from("school_assessment_schemes")
    .select("id, school_id, academic_year_id, academic_section_id, scheme_name, calculation_method, version_no, is_active")
    .eq("school_id", schoolId)
    .eq("is_active", true);

  if (schemeError) throw schemeError;

  const candidates = ((schemeRows ?? []) as AssessmentScheme[])
    .filter((scheme) =>
      (scheme.academic_year_id === null || scheme.academic_year_id === academicYearId) &&
      (scheme.academic_section_id === null || scheme.academic_section_id === academicSectionId),
    )
    .sort((left, right) => {
      const score = (scheme: AssessmentScheme) =>
        (scheme.academic_section_id === academicSectionId && academicSectionId ? 4 : 0) +
        (scheme.academic_year_id === academicYearId && academicYearId ? 2 : 0);
      return score(right) - score(left) || right.version_no - left.version_no;
    });

  const scheme = candidates[0] ?? null;
  if (!scheme) return { scheme: null, categories: [], grades: [] };

  const [{ data: categoryRows, error: categoryError }, { data: gradeRows, error: gradeError }] =
    await Promise.all([
      supabase
        .from("school_assessment_categories")
        .select("id, scheme_id, category_key, label, max_marks, weight_percent, display_order, enabled, contributes_to_total, is_required")
        .eq("scheme_id", scheme.id)
        .order("display_order", { ascending: true }),
      supabase
        .from("school_grading_scales")
        .select("id, scheme_id, min_percentage, max_percentage, grade, description, display_order")
        .eq("scheme_id", scheme.id)
        .order("display_order", { ascending: true }),
    ]);

  if (categoryError) throw categoryError;
  if (gradeError) throw gradeError;

  return {
    scheme,
    categories: (categoryRows ?? []) as AssessmentCategory[],
    grades: (gradeRows ?? []) as GradingBand[],
  };
}

/** Load an exact historical scheme version, used when editing an old assessment. */
export async function loadAssessmentSchemeById(
  schoolId: string,
  schemeId: string,
): Promise<AssessmentSchemeBundle> {
  const { data: schemeRow, error: schemeError } = await supabase
    .from("school_assessment_schemes")
    .select("id, school_id, academic_year_id, academic_section_id, scheme_name, calculation_method, version_no, is_active")
    .eq("school_id", schoolId)
    .eq("id", schemeId)
    .maybeSingle();

  if (schemeError) throw schemeError;
  if (!schemeRow) return { scheme: null, categories: [], grades: [] };

  const scheme = schemeRow as AssessmentScheme;
  const [{ data: categoryRows, error: categoryError }, { data: gradeRows, error: gradeError }] =
    await Promise.all([
      supabase
        .from("school_assessment_categories")
        .select("id, scheme_id, category_key, label, max_marks, weight_percent, display_order, enabled, contributes_to_total, is_required")
        .eq("scheme_id", scheme.id)
        .order("display_order", { ascending: true }),
      supabase
        .from("school_grading_scales")
        .select("id, scheme_id, min_percentage, max_percentage, grade, description, display_order")
        .eq("scheme_id", scheme.id)
        .order("display_order", { ascending: true }),
    ]);

  if (categoryError) throw categoryError;
  if (gradeError) throw gradeError;
  return {
    scheme,
    categories: (categoryRows ?? []) as AssessmentCategory[],
    grades: (gradeRows ?? []) as GradingBand[],
  };
}

export async function loadActiveReportCardTemplate(
  schoolId: string,
  academicYearId: string | null,
  academicSectionId: string | null,
): Promise<SchoolReportCardTemplate | null> {
  const { data, error } = await supabase
    .from("school_report_card_templates")
    .select("id, school_id, academic_year_id, academic_section_id, template_key, template_name, layout_config, version_no, is_active")
    .eq("school_id", schoolId)
    .eq("is_active", true);

  if (error) throw error;

  const candidates = ((data ?? []) as SchoolReportCardTemplate[])
    .filter((template) =>
      (template.academic_year_id === null || template.academic_year_id === academicYearId) &&
      (template.academic_section_id === null || template.academic_section_id === academicSectionId),
    )
    .sort((left, right) => {
      const score = (template: SchoolReportCardTemplate) =>
        (template.academic_section_id === academicSectionId && academicSectionId ? 4 : 0) +
        (template.academic_year_id === academicYearId && academicYearId ? 2 : 0);
      return score(right) - score(left) || right.version_no - left.version_no;
    });

  return candidates[0] ?? null;
}

export function normalizeAssessmentCategoryKey(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
