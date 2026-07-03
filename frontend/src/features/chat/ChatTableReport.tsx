import type { CSSProperties } from "react";
import { Table2, ShieldCheck, ShieldAlert, Download, Info, AlertTriangle } from "lucide-react";
import type {
  ChatGeneratedTable,
  CellVerification,
  PerPaperReason,
  CellTuple,
  ConditionConflict,
} from "@/types/chat";
import { localeText } from "@/lib/locale";
import { useUIStore } from "@/stores/uiStore";
import { useExportChatCsv } from "@/lib/chatQueries";

interface ChatTableReportProps {
  table: ChatGeneratedTable;
}

interface ChatTableReferencesProps {
  table: ChatGeneratedTable;
  onNavigateToPaper?: (paperId: string) => void;
}

/** "References · 참조" eyebrow label — inline equivalent of the kit's .eyebrow class (SettingsView precedent). */
const eyebrowStyle: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--color-text-muted)",
};

function getCellVerification(
  verification: CellVerification[] | null,
  row: number,
  col: number,
): CellVerification | undefined {
  if (!verification) return undefined;
  return verification.find((v) => v.row === row && v.col === col);
}

/** Read a cell tuple from the 2D metadata array, tolerant of ragged/absent data. */
function getCellTuple(
  cellTuples: (CellTuple | null)[][] | null | undefined,
  row: number,
  col: number,
): CellTuple | null {
  if (!Array.isArray(cellTuples)) return null;
  const r = cellTuples[row];
  if (!Array.isArray(r)) return null;
  return r[col] ?? null;
}

/**
 * Build the hover title for a cell (Phase 1 D1/D3): surfaces unit, measurement
 * condition, and source provenance without changing the visible scalar cell.
 * Falls back to the verification title when there is no tuple info.
 */
function buildCellTitle(tuple: CellTuple | null, verificationTitle: string | undefined): string | undefined {
  const parts: string[] = [];
  if (tuple?.unit) parts.push(`Unit: ${tuple.unit}`);
  if (tuple?.condition) parts.push(`Condition: ${tuple.condition}`);
  if (tuple?.source_hint) parts.push(`Source: ${tuple.source_hint}`);
  if (parts.length === 0) return verificationTitle;
  return verificationTitle ? `${parts.join(" · ")}\n${verificationTitle}` : parts.join(" · ");
}

/** Verification cell background — takes priority over zebra striping when present. */
function cellBgColor(status: string | undefined, zebra: boolean): string {
  if (status === "verified") return "rgba(15, 118, 110, 0.08)";
  if (status === "unverified") return "rgba(220, 38, 38, 0.08)";
  return zebra ? "var(--color-bg-base)" : "transparent";
}

function cellBorderColor(status: string | undefined): string {
  if (status === "verified") return "rgba(15, 118, 110, 0.25)";
  if (status === "unverified") return "rgba(220, 38, 38, 0.25)";
  return "var(--color-border-subtle)";
}

export function ChatTableReport({ table }: ChatTableReportProps) {
  const locale = useUIStore((s) => s.locale);
  const t = (en: string, ko: string) => localeText(locale, en, ko);
  const exportCsv = useExportChatCsv();

  const headers: string[] = Array.isArray(table.headers) ? table.headers : [];
  const rows: string[][] = Array.isArray(table.rows) ? table.rows : [];

  // Aggregate the real verification results into a single honest badge.
  // null → not yet verified (hidden); all verified → "Verified"; any unverified → "N unverified".
  const verification = table.verification;
  const hasVerification = Array.isArray(verification) && verification.length > 0;
  const unverifiedCount = hasVerification
    ? verification.filter((v) => v.status === "unverified").length
    : 0;
  const allVerified = hasVerification && unverifiedCount === 0;

  // "No data found" reasons (fix 19): papers that produced no real data row are
  // rendered as all-N/A rows above; this section explains *why* (per-paper LLM
  // notes or a default). Papers with data (hadRows) carry no reason and are skipped.
  const missingDataReasons: PerPaperReason[] = Array.isArray(table.metadata?.perPaperReasons)
    ? table.metadata.perPaperReasons.filter((r) => r && r.hadRows === false)
    : [];

  // Phase 1 (table-semantics-hardening): per-cell tuples (hover-only, D1/D3) and
  // condition conflicts (header warning, D1). Both are additive metadata; the visible
  // table body is unchanged. Absent on older tables / the single-call fallback path.
  const cellTuples = Array.isArray(table.metadata?.cellTuples) ? table.metadata.cellTuples : null;
  const conditionConflicts: ConditionConflict[] = Array.isArray(table.metadata?.conditionConflicts)
    ? table.metadata.conditionConflicts
    : [];
  const conflictByColumnIndex = new Map<number, ConditionConflict>();
  for (const conflict of conditionConflicts) {
    if (conflict && typeof conflict.columnIndex === "number") conflictByColumnIndex.set(conflict.columnIndex, conflict);
  }

  return (
    <div
      style={{
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        background: "var(--color-bg-elevated)",
      }}
    >
      {/* Title bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          borderBottom: "1px solid var(--color-border-subtle)",
        }}
      >
        <Table2 size={13} color="var(--color-accent)" style={{ flexShrink: 0 }} />
        <strong style={{ fontSize: 12.5, color: "var(--color-text-primary)" }}>
          {table.table_title || t("Generated Table", "생성된 테이블")}
        </strong>
        <div style={{ flex: 1 }} />

        {/* Verification badge — driven by real per-cell verification data (no fake "always verified") */}
        {allVerified ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 7px",
              borderRadius: "var(--radius-xs)",
              background: "rgba(15, 118, 110, 0.12)",
              color: "var(--color-success)",
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            <ShieldCheck size={10} />
            {t("Verified", "검증됨")}
          </span>
        ) : hasVerification ? (
          <span
            title={t("Some cells could not be verified", "일부 셀이 검증되지 않았습니다")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 7px",
              borderRadius: "var(--radius-xs)",
              background: "rgba(220, 38, 38, 0.12)",
              color: "var(--color-danger)",
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            <ShieldAlert size={10} />
            {t(`${unverifiedCount} unverified`, `미검증 ${unverifiedCount}건`)}
          </span>
        ) : null}

        <button
          onClick={() => exportCsv.mutate(table.id)}
          disabled={exportCsv.isPending}
          title={t("Export CSV", "CSV 내보내기")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 8px",
            borderRadius: "var(--radius-xs)",
            border: "1px solid var(--color-border-subtle)",
            background: "var(--color-bg-elevated)",
            cursor: "pointer",
            fontSize: 11,
            color: "var(--color-text-secondary)",
          }}
        >
          <Download size={12} />
          CSV
        </button>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 12,
          }}
        >
          <thead>
            <tr>
              {headers.map((h, i) => {
                const conflict = conflictByColumnIndex.get(i);
                return (
                  <th
                    key={i}
                    title={conflict
                      ? t(
                          `Mixed measurement conditions in this column: ${conflict.conditions.join("; ")}`,
                          `이 열에 서로 다른 측정 조건이 혼재합니다: ${conflict.conditions.join("; ")}`,
                        )
                      : undefined}
                    style={{
                      padding: "8px 12px",
                      textAlign: "left",
                      fontWeight: 700,
                      fontSize: 11,
                      color: "var(--color-text-secondary)",
                      borderBottom: "1px solid var(--color-border-subtle)",
                      background: "var(--color-bg-surface)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {h}
                      {conflict ? (
                        <AlertTriangle size={11} color="var(--color-warning, #d97706)" style={{ flexShrink: 0 }} />
                      ) : null}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const isLastRow = ri === rows.length - 1;
              return (
                <tr key={ri}>
                  {row.map((cell, ci) => {
                    const v = getCellVerification(table.verification, ri, ci);
                    const verificationTitle = v ? `${v.status}${v.evidence ? ": " + v.evidence : ""}` : undefined;
                    const tuple = getCellTuple(cellTuples, ri, ci);
                    return (
                      <td
                        key={ci}
                        title={buildCellTitle(tuple, verificationTitle)}
                        style={{
                          padding: "8px 12px",
                          borderBottom: isLastRow ? "none" : "1px solid var(--color-border-subtle)",
                          borderLeft: ci > 0 && v ? `1px solid ${cellBorderColor(v.status)}` : undefined,
                          background: cellBgColor(v?.status, ri % 2 === 1),
                          color: ci === 0 ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                          fontWeight: ci === 0 ? 600 : 400,
                          fontVariantNumeric: "tabular-nums",
                          lineHeight: 1.5,
                        }}
                      >
                        {cell}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Verification legend (kept — explains the per-cell colors) */}
      {hasVerification && (
        <div
          style={{
            display: "flex",
            gap: 16,
            padding: "8px 14px",
            borderTop: "1px solid var(--color-border-subtle)",
            fontSize: 11,
            color: "var(--color-text-muted)",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: "var(--color-success)",
              }}
            />
            {t("Verified", "검증됨")}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: "var(--color-danger)",
              }}
            />
            {t("Unverified", "미검증")}
          </span>
        </div>
      )}

      {/* "No data found" section (fix 19) — explains why some scope papers have
          all-N/A rows. Reason strings come from the extraction LLM (English);
          labels are localized. Hidden when every paper contributed data. */}
      {missingDataReasons.length > 0 && (
        <div
          style={{
            padding: "10px 14px",
            borderTop: "1px solid var(--color-border-subtle)",
            background: "var(--color-bg-surface)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              marginBottom: 6,
            }}
          >
            <Info size={11} color="var(--color-text-muted)" style={{ flexShrink: 0 }} />
            <span style={eyebrowStyle}>{t("No data found", "데이터 없음")}</span>
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 4 }}>
            {missingDataReasons.map((reason) => (
              <li
                key={reason.paperId}
                style={{
                  fontSize: 11.5,
                  color: "var(--color-text-secondary)",
                  lineHeight: 1.5,
                  display: "flex",
                  gap: 6,
                  alignItems: "baseline",
                }}
              >
                {reason.refNo ? (
                  <span
                    style={{
                      flexShrink: 0,
                      fontWeight: 700,
                      color: "var(--color-accent)",
                    }}
                  >
                    [{reason.refNo}]
                  </span>
                ) : null}
                <span style={{ minWidth: 0 }}>
                  <span style={{ color: "var(--color-text-primary)", fontWeight: 600 }}>
                    {reason.paperTitle || t("Untitled", "제목 없음")}
                  </span>
                  {reason.note ? (
                    <span style={{ color: "var(--color-text-muted)" }}> — {reason.note}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** References — kit separated-card block, driven by real source_refs (navigate + DOI + evidence preserved). */
export function ChatTableReferences({
  table,
  onNavigateToPaper,
}: ChatTableReferencesProps) {
  const locale = useUIStore((s) => s.locale);
  const t = (en: string, ko: string) => localeText(locale, en, ko);

  const refs = table.source_refs;
  if (!refs || refs.length === 0) return null;

  return (
    <div style={{ display: "grid", gap: 6, marginTop: 14 }}>
      <div style={eyebrowStyle}>{t("References", "참조")}</div>
      {refs.map((ref, i) => {
        const evidence = ref.evidenceSummary || ref.evidenceLocations?.join("; ");
        const canNavigate = Boolean(ref.paperId && onNavigateToPaper);
        return (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              padding: "8px 10px",
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border-subtle)",
              borderRadius: "var(--radius-sm)",
            }}
          >
            <span
              style={{
                flexShrink: 0,
                fontSize: 11,
                fontWeight: 700,
                color: "var(--color-accent)",
                background: "var(--color-accent-subtle)",
                padding: "1px 6px",
                borderRadius: "var(--radius-xs)",
              }}
            >
              [{ref.refNo}]
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                  lineHeight: 1.4,
                  cursor: canNavigate ? "pointer" : undefined,
                  textDecoration: canNavigate ? "underline" : undefined,
                }}
                onClick={() => ref.paperId && onNavigateToPaper?.(ref.paperId)}
              >
                {ref.title}
                {ref.doi ? (
                  <span
                    style={{ color: "var(--color-accent)", marginLeft: 6, fontSize: 10.5, cursor: "pointer" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      window.redouDesktop?.openExternal(`https://doi.org/${ref.doi}`);
                    }}
                  >
                    DOI
                  </span>
                ) : null}
              </div>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                {ref.authors ? `${ref.authors}` : ""}
                {ref.authors && ref.year ? " · " : ""}
                {ref.year ? `${ref.year}` : ""}
              </div>
              {evidence ? (
                <div style={{ marginTop: 3, color: "var(--color-text-muted)", fontSize: 10.5 }}>
                  {evidence}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
