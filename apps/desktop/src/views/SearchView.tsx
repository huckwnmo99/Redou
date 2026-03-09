import type { PaperRecord } from "../types";

interface SearchViewProps {
  query: string;
  categoryLabel: string;
  papers: PaperRecord[];
}

export function SearchView({ query, categoryLabel, papers }: SearchViewProps) {
  const shown = papers.slice(0, 2);

  return (
    <section className="content">
      <div className="three-col">
        <section className="panel">
          <h4>Papers</h4>
          {shown.map((paper) => (
            <div className="result-row" key={paper.id}>
              <strong>{paper.title}</strong>
              <div className="muted">{`category: ${categoryLabel}`}</div>
            </div>
          ))}
        </section>

        <section className="panel">
          <h4>Chunks</h4>
          <div className="result-row">
            <strong>Results / p.7</strong>
            <div className="muted">recovery decreased at higher pressure under the tested cycle...</div>
          </div>
          <div className="result-row">
            <strong>Discussion / p.8</strong>
            <div className="muted">trade-off depends on cycle timing and layered arrangement...</div>
          </div>
        </section>

        <section className="panel">
          <h4>Notes + Figures</h4>
          <div className="result-row">
            <strong>Note</strong>
            <div className="muted">compare with Lee 2024 before using in introduction</div>
          </div>
          <div className="result-row">
            <strong>Figure 6</strong>
            <div className="muted">purity-recovery trade-off plot linked to query: {query}</div>
          </div>
        </section>
      </div>
    </section>
  );
}

