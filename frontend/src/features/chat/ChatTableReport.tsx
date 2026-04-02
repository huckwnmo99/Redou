import { Download } from "lucide-react";
import type { ChatGeneratedTable, CellVerification } from "@/types/chat";
import { localeText } from "@/lib/locale";
import { useUIStore } from "@/stores/uiStore";
import { useExportChatCsv } from "@/lib/chatQueries";

interface ChatTableReportProps {
  table: ChatGeneratedTable;
  onNavigateToPaper?: (paperId: string) => void;
}

function getCellVerification(
  verification: CellVerification[] | null,
  row: number,
  col: number,
): CellVerification | undefined {
  if (!verification) return undefined;
  return verification.find((v) => v.row === row && v.col === col);
}

function cellBgColor(status: string | undefined): string {
  if (status === "verified") return "rgba(15, 118, 110, 0.08)";
  if (status === "unverified") return "rgba(220, 38, 38, 0.08)";
  return "transparent";
}

function cellBorderColor(status: string | undefined): string {
  if (status === "verified") return "rgba(15, 118, 110, 0.25)";
  if (status === "unverified") return "rgba(220, 38, 38, 0.25)";
  return "var(--color-border-subtle)";
}

export function ChatTableReport({ table, onNavigateToPaper }: ChatTableReportProps) {
  const locale = useUIStore((s) => s.locale);
  const t = (en: string, ko: string) => localeText(locale, en, ko);
  const exportCsv = useExportChatCsv();

  const headers: string[] = Array.isArray(table.headers) ? table.headers : [];
  const rows: string[][] = Array.isArray(table.rows) ? table.rows : [];

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
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid var(--color-border-subtle)",
          background: "var(--color-bg-panel)",
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text-primary)" }}>
          {table.table_title || t("Generated Table", "생성된 테이블")}
        </span>
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
              {headers.map((h, i) => (
                <th
                  key={i}
                  style={{
                    padding: "8px 10px",
                    textAlign: "left",
                    fontWeight: 600,
                    fontSize: 11.5,
                    color: "var(--color-text-secondary)",
                    borderBottom: "2px solid var(--color-border)",
                    background: "var(--color-bg-panel)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => {
                  const v = getCellVerification(table.verification, ri, ci);
                  return (
                    <td
                      key={ci}
                      title={v ? `${v.status}${v.evidence ? ": " + v.evidence : ""}` : undefined}
                      style={{
                        padding: "7px 10px",
                        borderBottom: "1px solid var(--color-border-subtle)",
                        borderLeft: ci > 0 ? `1px solid ${cellBorderColor(v?.status)}` : undefined,
                        background: cellBgColor(v?.status),
                        color: "var(--color-text-primary)",
                        lineHeight: 1.5,
                      }}
                    >
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Verification legend */}
      {table.verification && table.verification.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 16,
            padding: "8px 12px",
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

      {/* References */}
      {table.source_refs && table.source_refs.length > 0 && (
        <div
          style={{
            padding: "8px 12px",
            borderTop: "1px solid var(--color-border-subtle)",
            fontSize: 11.5,
            color: "var(--color-text-secondary)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {t("References", "참고문헌")}
          </div>
          {table.source_refs.map((ref, i) => (
            <div
              key={i}
              style={{
                marginBottom: 2,
                cursor: ref.paperId && onNavigateToPaper ? "pointer" : undefined,
                textDecoration: ref.paperId && onNavigateToPaper ? "underline" : undefined,
              }}
              onClick={() => ref.paperId && onNavigateToPaper?.(ref.paperId)}
            >
              [{ref.refNo}] {ref.authors ? `${ref.authors}, ` : ""}{ref.title}
              {ref.year ? ` (${ref.year})` : ""}
              {ref.doi ? (
                <span
                  style={{ color: "var(--color-accent)", marginLeft: 4, fontSize: 10.5, cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); window.redouDesktop?.openExternal(`https://doi.org/${ref.doi}`); }}
                >
                  DOI
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
