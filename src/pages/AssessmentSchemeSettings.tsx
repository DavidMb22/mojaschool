import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, CirclePlus, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useSchool } from "../context/SchoolContext";
import { normalizeRole } from "../lib/permissions";
import { supabase } from "../lib/supabase";
import {
  loadActiveAssessmentScheme,
  loadActiveReportCardTemplate,
  type AssessmentCategory,
  type AssessmentScheme,
  type CalculationMethod,
  type GradingBand,
} from "../lib/assessmentSchemes";

type AcademicYear = { id: string; name: string; is_active: boolean; is_current: boolean };
type AcademicSection = { id: string; name: string; academic_year_id: string; display_order: number; is_active: boolean };
type CategoryDraft = {
  category_key: string;
  label: string;
  max_marks: string;
  weight_percent: string;
  display_order: number;
  enabled: boolean;
  contributes_to_total: boolean;
  is_required: boolean;
};
type GradeDraft = {
  min_percentage: string;
  max_percentage: string;
  grade: string;
  description: string;
  display_order: number;
};
type TemplateKey = "standard-v1" | "high-gate-primary-v1" | "high-gate-nursery-v1" | "high-gate-auto-v1";

const HIGH_GATE_CATEGORIES: CategoryDraft[] = [
  { category_key: "cat_i", label: "CAT I", max_marks: "40", weight_percent: "", display_order: 1, enabled: true, contributes_to_total: true, is_required: true },
  { category_key: "cat_ii", label: "CAT II", max_marks: "40", weight_percent: "", display_order: 2, enabled: true, contributes_to_total: true, is_required: true },
  { category_key: "class_participation", label: "C.P", max_marks: "10", weight_percent: "", display_order: 3, enabled: true, contributes_to_total: true, is_required: true },
  { category_key: "homework_projects", label: "HW&Pr", max_marks: "10", weight_percent: "", display_order: 4, enabled: true, contributes_to_total: true, is_required: true },
  { category_key: "exam", label: "Exam", max_marks: "100", weight_percent: "", display_order: 5, enabled: true, contributes_to_total: true, is_required: true },
];
const HIGH_GATE_GRADES: GradeDraft[] = [
  { min_percentage: "90", max_percentage: "100", grade: "A*", description: "Outstanding", display_order: 1 },
  { min_percentage: "80", max_percentage: "89.999", grade: "A", description: "Excellent", display_order: 2 },
  { min_percentage: "70", max_percentage: "79.999", grade: "B", description: "Very Good", display_order: 3 },
  { min_percentage: "60", max_percentage: "69.999", grade: "C", description: "Good", display_order: 4 },
  { min_percentage: "50", max_percentage: "59.999", grade: "D", description: "Satisfactory", display_order: 5 },
  { min_percentage: "40", max_percentage: "49.999", grade: "E", description: "Pass", display_order: 6 },
  { min_percentage: "30", max_percentage: "39.999", grade: "F", description: "Weak", display_order: 7 },
  { min_percentage: "20", max_percentage: "29.999", grade: "G", description: "Very Weak", display_order: 8 },
  { min_percentage: "0", max_percentage: "19.999", grade: "U", description: "Ungraded", display_order: 9 },
];

function normaliseIdentity(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function slugKey(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
function categoryDrafts(rows: AssessmentCategory[]): CategoryDraft[] {
  return rows.map((row, index) => ({
    category_key: row.category_key,
    label: row.label,
    max_marks: String(row.max_marks),
    weight_percent: row.weight_percent === null ? "" : String(row.weight_percent),
    display_order: index + 1,
    enabled: row.enabled,
    contributes_to_total: row.contributes_to_total,
    is_required: row.is_required,
  }));
}
function gradeDrafts(rows: GradingBand[]): GradeDraft[] {
  return rows.map((row, index) => ({
    min_percentage: String(row.min_percentage),
    max_percentage: String(row.max_percentage),
    grade: row.grade,
    description: row.description ?? "",
    display_order: index + 1,
  }));
}
const panelClass = "rounded-2xl border border-slate-200 bg-white shadow-sm";
const fieldClass = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";

export default function AssessmentSchemeSettings() {
  const { school, membership } = useSchool();
  const navigate = useNavigate();
  const role = normalizeRole(membership?.role);
  const canManage = ["Owner", "Principal", "Head of Academics"].includes(role);
  const isHighGate = [school?.name, school?.slug].some((value) =>
    normaliseIdentity(value) === "highgateinternationalacademy" || normaliseIdentity(value) === "highgateinternational",
  );

  const [years, setYears] = useState<AcademicYear[]>([]);
  const [sections, setSections] = useState<AcademicSection[]>([]);
  const [selectedYearId, setSelectedYearId] = useState("");
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [scheme, setScheme] = useState<AssessmentScheme | null>(null);
  const [schemeName, setSchemeName] = useState("");
  const [calculationMethod, setCalculationMethod] = useState<CalculationMethod>("average_percentages");
  const [categories, setCategories] = useState<CategoryDraft[]>([]);
  const [grades, setGrades] = useState<GradeDraft[]>([]);
  const [templateKey, setTemplateKey] = useState<TemplateKey>("standard-v1");
  const [templateId, setTemplateId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingScope, setLoadingScope] = useState(false);
  const [savingScheme, setSavingScheme] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadMetadata() {
      if (!school?.id) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const [yearResult, sectionResult] = await Promise.all([
          supabase.from("academic_years").select("id, name, is_active, is_current").eq("school_id", school.id).order("name", { ascending: false }),
          supabase.from("academic_sections").select("id, name, academic_year_id, display_order, is_active").eq("school_id", school.id).order("display_order", { ascending: true }),
        ]);
        if (yearResult.error) throw yearResult.error;
        if (sectionResult.error) throw sectionResult.error;
        if (cancelled) return;
        const loadedYears = (yearResult.data ?? []) as AcademicYear[];
        const loadedSections = (sectionResult.data ?? []) as AcademicSection[];
        setYears(loadedYears);
        setSections(loadedSections);
        const activeYear = loadedYears.find((year) => year.is_current && year.is_active) ?? loadedYears.find((year) => year.is_active) ?? loadedYears[0];
        setSelectedYearId(activeYear?.id ?? "");
        const preferredSection = loadedSections.find((section) =>
          (activeYear?.id ? section.academic_year_id === activeYear.id : true) &&
          (isHighGate ? section.name.toLowerCase().includes("primary") : section.is_active),
        ) ?? loadedSections.find((section) => (activeYear?.id ? section.academic_year_id === activeYear.id : true) && section.is_active);
        setSelectedSectionId(preferredSection?.id ?? "");
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Unable to load academic scope.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadMetadata();
    return () => { cancelled = true; };
  }, [school?.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadScope() {
      if (!school?.id || loading) return;
      setLoadingScope(true);
      setError("");
      setSuccess("");
      try {
        const sectionId = selectedSectionId || null;
        const yearId = selectedYearId || null;
        const [schemeResult, templateResult] = await Promise.all([
          loadActiveAssessmentScheme(school.id, yearId, sectionId),
          loadActiveReportCardTemplate(school.id, yearId, sectionId),
        ]);
        if (cancelled) return;
        setScheme(schemeResult.scheme);
        setSchemeName(schemeResult.scheme?.scheme_name ?? `${school.name} Assessment Scheme`);
        setCalculationMethod(schemeResult.scheme?.calculation_method ?? "average_percentages");
        setCategories(categoryDrafts(schemeResult.categories));
        setGrades(gradeDrafts(schemeResult.grades));
        setTemplateId(templateResult?.id ?? "");
        const key = templateResult?.template_key as TemplateKey | undefined;
        setTemplateKey(key ?? (isHighGate ? "high-gate-auto-v1" : "standard-v1"));
      } catch (loadError) {
        if (!cancelled) {
          setScheme(null);
          setCategories([]);
          setGrades([]);
          setTemplateId("");
          setError(`Unable to load assessment configuration. Make sure the Supabase migration 20261012_school_assessment_schemes.sql has been applied. ${loadError instanceof Error ? loadError.message : ""}`);
        }
      } finally {
        if (!cancelled) setLoadingScope(false);
      }
    }
    void loadScope();
    return () => { cancelled = true; };
  }, [school?.id, selectedYearId, selectedSectionId, loading, isHighGate, school?.name]);

  const sectionOptions = useMemo(
    () => sections.filter((section) => !selectedYearId || section.academic_year_id === selectedYearId),
    [sections, selectedYearId],
  );
  const selectedSectionName = sections.find((section) => section.id === selectedSectionId)?.name ?? "";
  const isPrimaryScope = /primary/i.test(selectedSectionName);
  const isEarlyYearsScope = /(nursery|crèche|creche|preschool|pre-school|pre school)/i.test(selectedSectionName);

  useEffect(() => {
    if (!selectedYearId || !selectedSectionId) return;
    const selectedSection = sections.find((section) => section.id === selectedSectionId);
    if (selectedSection && selectedSection.academic_year_id !== selectedYearId) {
      const sameNamedSection = sections.find((section) => section.academic_year_id === selectedYearId && section.name === selectedSection.name && section.is_active);
      const firstActiveSection = sections.find((section) => section.academic_year_id === selectedYearId && section.is_active);
      setSelectedSectionId(sameNamedSection?.id ?? firstActiveSection?.id ?? "");
    }
  }, [selectedYearId, selectedSectionId, sections]);

  function updateCategory(index: number, patch: Partial<CategoryDraft>) {
    setCategories((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }
  function addCategory() {
    setCategories((current) => [...current, {
      category_key: "", label: "", max_marks: "100", weight_percent: "", display_order: current.length + 1,
      enabled: true, contributes_to_total: true, is_required: false,
    }]);
  }
  function addGrade() {
    setGrades((current) => [...current, {
      min_percentage: "0", max_percentage: "100", grade: "", description: "", display_order: current.length + 1,
    }]);
  }

  function loadHighGatePreset() {
    setSchemeName("High Gate Primary Termly Assessment");
    setCalculationMethod("total_to_percentage");
    setCategories(HIGH_GATE_CATEGORIES.map((item) => ({ ...item })));
    setGrades(HIGH_GATE_GRADES.map((item) => ({ ...item })));
    setSuccess("High Gate preset loaded in the editor. Save the scheme to create a new version.");
    setError("");
  }

  async function saveScheme() {
    if (!school?.id || !canManage) return;
    setError("");
    setSuccess("");
    if (!schemeName.trim()) { setError("Enter a name for this assessment scheme."); return; }
    if (categories.filter((item) => item.enabled).length === 0) { setError("Add at least one enabled assessment category."); return; }
    const categoryKeys = categories.map((item) => slugKey(item.category_key || item.label)).filter(Boolean);
    if (new Set(categoryKeys).size !== categoryKeys.length) { setError("Each assessment category needs a unique key or label, including disabled categories."); return; }
    for (const item of categories.filter((category) => category.enabled)) {
      if (!item.label.trim() || !Number.isFinite(Number(item.max_marks)) || Number(item.max_marks) <= 0) {
        setError("Every enabled category needs a label and a maximum mark greater than zero."); return;
      }
    }
    if (calculationMethod === "weighted_average") {
      const includedCategories = categories.filter((item) => item.enabled && item.contributes_to_total);
      if (includedCategories.some((item) => item.weight_percent.trim() === "" || !Number.isFinite(Number(item.weight_percent)) || Number(item.weight_percent) <= 0)) {
        setError("Every enabled category that contributes to a weighted average needs a weight greater than zero."); return;
      }
      const totalWeight = includedCategories.reduce((sum, item) => sum + Number(item.weight_percent), 0);
      if (Math.abs(totalWeight - 100) > 0.01) { setError(`The weights of enabled categories that contribute to the total must add up to 100% (currently ${totalWeight.toFixed(2)}%).`); return; }
    }
    if (grades.length === 0) { setError("Add at least one grading band."); return; }
    const gradeLabels = grades.map((grade) => grade.grade.trim().toLowerCase());
    if (gradeLabels.some((label) => !label) || new Set(gradeLabels).size !== gradeLabels.length) { setError("Every grading band needs a unique grade label."); return; }
    for (const grade of grades) {
      const min = Number(grade.min_percentage);
      const max = Number(grade.max_percentage);
      if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max > 100 || min > max) {
        setError("Grading bands must be between 0% and 100%, with minimum not exceeding maximum."); return;
      }
    }
    const sortedBands = [...grades].sort((left, right) => Number(left.min_percentage) - Number(right.min_percentage));
    for (let index = 1; index < sortedBands.length; index += 1) {
      if (Number(sortedBands[index].min_percentage) <= Number(sortedBands[index - 1].max_percentage)) {
        setError("Grading bands must not overlap. Check the minimum and maximum percentages."); return;
      }
    }
    setSavingScheme(true);
    try {
      const { data, error: saveError } = await supabase.rpc("save_school_assessment_scheme", {
        p_school_id: school.id,
        p_academic_year_id: selectedYearId || null,
        p_academic_section_id: selectedSectionId || null,
        p_scheme_name: schemeName.trim(),
        p_calculation_method: calculationMethod,
        p_categories: categories.map((item, index) => ({
          category_key: slugKey(item.category_key || item.label), label: item.label.trim(), max_marks: Number(item.max_marks),
          weight_percent: item.weight_percent.trim() === "" ? null : Number(item.weight_percent), display_order: index + 1,
          enabled: item.enabled, contributes_to_total: item.contributes_to_total, is_required: item.is_required,
        })),
        p_grades: grades.map((item, index) => ({
          min_percentage: Number(item.min_percentage), max_percentage: Number(item.max_percentage), grade: item.grade.trim(),
          description: item.description.trim() || null, display_order: index + 1,
        })),
      });
      if (saveError) throw saveError;
      if (!data) throw new Error("The database did not return the new scheme ID.");
      setSuccess("Assessment scheme saved as a new version. Previously linked assessments retain their original scheme version.");
      const bundle = await loadActiveAssessmentScheme(school.id, selectedYearId || null, selectedSectionId || null);
      setScheme(bundle.scheme);
      setCategories(categoryDrafts(bundle.categories));
      setGrades(gradeDrafts(bundle.grades));
      setSchemeName(bundle.scheme?.scheme_name ?? schemeName);
      setCalculationMethod(bundle.scheme?.calculation_method ?? calculationMethod);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save the assessment scheme.");
    } finally {
      setSavingScheme(false);
    }
  }

  async function saveTemplate() {
    if (!school?.id || !canManage) return;
    setError("");
    setSuccess("");
    const sectionName = sections.find((section) => section.id === selectedSectionId)?.name ?? "";
    const allowedHighGateTemplate = isHighGate && (templateKey === "high-gate-auto-v1" || (sectionName.toLowerCase().includes("primary") && templateKey === "high-gate-primary-v1") || ((/nursery|crèche|creche|preschool/i).test(sectionName) && templateKey === "high-gate-nursery-v1"));
    if (!isHighGate && templateKey !== "standard-v1") {
      setError("Only the standard template is installed for this school. A custom physical layout can be added when the school supplies its report card."); return;
    }
    if (templateKey.startsWith("high-gate-") && !allowedHighGateTemplate) {
      setError("Choose the High Gate template matching the selected academic section."); return;
    }
    setSavingTemplate(true);
    try {
      const { data, error: saveError } = await supabase.rpc("save_school_report_card_template", {
        p_school_id: school.id,
        p_academic_year_id: selectedYearId || null,
        p_academic_section_id: selectedSectionId || null,
        p_template_key: templateKey,
        p_template_name: templateKey === "standard-v1" ? "Standard MojaSchool report" : templateKey === "high-gate-primary-v1" ? "High Gate Primary physical report" : templateKey === "high-gate-nursery-v1" ? "High Gate early-years report" : "High Gate school report templates",
        p_layout_config: {},
      });
      if (saveError) throw saveError;
      setTemplateId(String(data ?? ""));
      setSuccess("Report-card template selection saved. Template layout-field mapping is the next implementation phase.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save the report-card template.");
    } finally {
      setSavingTemplate(false);
    }
  }

  if (loading) {
    return <div className="flex min-h-[320px] items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="animate-spin" size={18} /> Loading academic settings…</div>;
  }

  if (!school) return <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">No school is associated with this account.</div>;
  if (!canManage) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">Only the school Owner, Principal or Head of Academics can configure assessment schemes and report-card settings.</div>;

  return (
    <div className="mx-auto max-w-[1240px] space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <button type="button" onClick={() => navigate("/assessments")} className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-700"><ArrowLeft size={16} /> Back to assessments</button>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600">Academic configuration</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Assessment scheme & report cards</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">Configure this school's assessment categories, calculation formula, grading scale and installed report-card template. These settings are scoped to this school and selected academic section/year.</p>
        </div>
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 shrink-0" size={17} />{success}</div>}

      <section className={`${panelClass} p-5`}>
        <div className="mb-4">
          <h2 className="text-base font-semibold text-slate-900">Configuration scope</h2>
          <p className="mt-1 text-sm text-slate-500">A school-wide scheme is the fallback. A section-specific or academic-year-specific scheme takes precedence when present.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">Academic year
            <select className={`${fieldClass} mt-1.5`} value={selectedYearId} onChange={(event) => setSelectedYearId(event.target.value)}>
              <option value="">School-wide (all academic years)</option>
              {years.map((year) => <option key={year.id} value={year.id}>{year.name}{year.is_active ? " · Active" : ""}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">Educational section
            <select className={`${fieldClass} mt-1.5`} value={selectedSectionId} onChange={(event) => setSelectedSectionId(event.target.value)}>
              <option value="">School-wide (all sections)</option>
              {sectionOptions.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
            </select>
          </label>
        </div>
        {loadingScope && <div className="mt-4 flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Loading the selected configuration…</div>}
      </section>

      <section className={`${panelClass} p-5`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Assessment scheme</h2>
            <p className="mt-1 text-sm text-slate-500">Each category has its own maximum mark. Saving creates a new version, so existing assessments can retain the scheme version they were created with.</p>
            {scheme && <p className="mt-1 text-xs font-medium text-indigo-600">Active version {scheme.version_no} · {scheme.scheme_name}</p>}
          </div>
          {isHighGate && isPrimaryScope && <button type="button" onClick={loadHighGatePreset} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-100"><CirclePlus size={16} /> Load High Gate preset</button>}
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">Scheme name
            <input className={`${fieldClass} mt-1.5`} value={schemeName} onChange={(event) => setSchemeName(event.target.value)} placeholder="e.g. Primary term assessment" />
          </label>
          <label className="block text-sm font-medium text-slate-700">How should the final percentage be calculated?
            <select className={`${fieldClass} mt-1.5`} value={calculationMethod} onChange={(event) => setCalculationMethod(event.target.value as CalculationMethod)}>
              <option value="total_to_percentage">Total earned marks ÷ total possible marks</option>
              <option value="weighted_average">Weighted average by category percentages</option>
              <option value="average_percentages">Simple average of category percentages</option>
            </select>
          </label>
        </div>
        <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
          {calculationMethod === "total_to_percentage" ? "The final percentage is calculated from the combined marks earned divided by the combined maximum marks. High Gate's 40 + 40 + 10 + 10 + 100 scheme uses this method." : calculationMethod === "weighted_average" ? "Each category percentage is multiplied by its configured weight. Enabled categories that contribute to the total must have weights adding up to 100%." : "The system averages the percentages of the categories that have marks. Maximum marks do not change a category's influence on the final percentage."}
        </div>

        <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[780px]">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3">Category label</th><th className="px-3 py-3">Maximum</th><th className="px-3 py-3">Weight %</th><th className="px-3 py-3">Include</th><th className="px-3 py-3">Required</th><th className="px-3 py-3" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {categories.map((item, index) => <tr key={`${item.category_key}-${index}`} className={!item.enabled ? "bg-slate-50 text-slate-400" : "bg-white"}>
                <td className="px-3 py-2"><input className={fieldClass} value={item.label} onChange={(event) => updateCategory(index, { label: event.target.value, category_key: item.category_key || slugKey(event.target.value) })} placeholder="e.g. CAT I" /></td>
                <td className="w-28 px-3 py-2"><input type="number" min="0.01" step="0.01" className={fieldClass} value={item.max_marks} onChange={(event) => updateCategory(index, { max_marks: event.target.value })} /></td>
                <td className="w-28 px-3 py-2"><input type="number" min="0" max="100" step="0.01" className={fieldClass} value={item.weight_percent} onChange={(event) => updateCategory(index, { weight_percent: event.target.value })} placeholder="Optional" disabled={calculationMethod !== "weighted_average"} /></td>
                <td className="px-3 py-2"><label className="inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={item.enabled} onChange={(event) => updateCategory(index, { enabled: event.target.checked })} className="h-4 w-4 accent-emerald-600" /> Enabled</label><label className="mt-1 flex items-center gap-2 text-xs"><input type="checkbox" checked={item.contributes_to_total} onChange={(event) => updateCategory(index, { contributes_to_total: event.target.checked })} className="h-4 w-4 accent-emerald-600" /> Counts toward total</label></td>
                <td className="px-3 py-2"><input type="checkbox" checked={item.is_required} onChange={(event) => updateCategory(index, { is_required: event.target.checked })} aria-label={`Make ${item.label || "category"} required`} className="h-4 w-4 accent-indigo-600" /></td>
                <td className="px-3 py-2"><button type="button" onClick={() => setCategories((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove ${item.label || "category"}`}><Trash2 size={15} /></button></td>
              </tr>)}
              {categories.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center"><p className="text-sm font-medium text-slate-700">No assessment categories configured yet</p><p className="mt-1 text-xs text-slate-500">Add the categories used by this school. We will not assume that another school's categories fit this one.</p></td></tr>}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button type="button" onClick={addCategory} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Plus size={16} /> Add category</button>
          <button type="button" onClick={() => void saveScheme()} disabled={savingScheme || loadingScope || !canManage} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60">{savingScheme ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save scheme as new version</button>
        </div>
      </section>

      <section className={`${panelClass} p-5`}>
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-slate-900">Grading scale</h2><p className="mt-1 text-sm text-slate-500">Define the percent range and grade label for this school. Ranges should not overlap.</p></div><button type="button" onClick={addGrade} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Plus size={16} /> Add grade</button></div>
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[680px]"><thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3">Minimum %</th><th className="px-3 py-3">Maximum %</th><th className="px-3 py-3">Grade</th><th className="px-3 py-3">Meaning / description</th><th className="px-3 py-3" /></tr></thead><tbody className="divide-y divide-slate-100">{grades.map((item, index) => <tr key={`${item.grade}-${index}`}><td className="w-32 px-3 py-2"><input type="number" min="0" max="100" step="0.001" className={fieldClass} value={item.min_percentage} onChange={(event) => setGrades((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, min_percentage: event.target.value } : row))} /></td><td className="w-32 px-3 py-2"><input type="number" min="0" max="100" step="0.001" className={fieldClass} value={item.max_percentage} onChange={(event) => setGrades((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, max_percentage: event.target.value } : row))} /></td><td className="w-28 px-3 py-2"><input className={fieldClass} value={item.grade} onChange={(event) => setGrades((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, grade: event.target.value } : row))} /></td><td className="px-3 py-2"><input className={fieldClass} value={item.description} onChange={(event) => setGrades((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, description: event.target.value } : row))} placeholder="Optional" /></td><td className="px-3 py-2"><button type="button" onClick={() => setGrades((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove grade ${item.grade}`}><Trash2 size={15} /></button></td></tr>)}{grades.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">No grading bands configured. Add the grades used by this school.</td></tr>}</tbody></table></div>
        <div className="mt-3 text-xs text-slate-500">Grading scale rows are saved together with the scheme as a new version. Save the scheme after changing categories or grades.</div>
      </section>

      <section className={`${panelClass} p-5`}>
        <div><h2 className="text-base font-semibold text-slate-900">Report-card template</h2><p className="mt-1 text-sm text-slate-500">Choose a report renderer already installed in MojaSchool for the selected scope. This prevents one school's branding from being assigned to another school.</p></div>
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <label className="block text-sm font-medium text-slate-700">Installed template
            <select className={`${fieldClass} mt-1.5`} value={templateKey} onChange={(event) => setTemplateKey(event.target.value as TemplateKey)}>
              <option value="standard-v1">Standard MojaSchool report</option>
              {isHighGate && <option value="high-gate-auto-v1">High Gate report (choose layout by section)</option>}
              {isHighGate && isPrimaryScope && <option value="high-gate-primary-v1">High Gate Primary physical report</option>}
              {isHighGate && isEarlyYearsScope && <option value="high-gate-nursery-v1">High Gate early-years report</option>}
            </select>
          </label>
          <button type="button" onClick={() => void saveTemplate()} disabled={savingTemplate || loadingScope} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">{savingTemplate ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save template</button>
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-500">Template selection is versioned and school-scoped. The database also supports per-field positions for a future custom-PDF mapping editor, but this first phase only selects an installed layout; it does not yet provide a drag-and-drop PDF designer. {templateId ? "An applicable template version is loaded for this scope (it may be a school-wide fallback)." : "No applicable template has been saved yet; the system will use the installed default."}</p>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900"><strong>Safe rollout:</strong> existing assessments remain valid. Once you configure a scheme, new assessments can reference the selected category/version. Historical assessments retain their previous scheme IDs and the report-card page keeps its current fallback when no scheme has been configured.</section>
    </div>
  );
}
