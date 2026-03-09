import type { PaperRecord, TopCategory } from "../types";

interface PaperDetailViewProps {
  paper: PaperRecord;
  categoryLabel: string;
  topCategory: TopCategory;
  onOpenReader: () => void;
}

export function PaperDetailView({
  paper,
  categoryLabel,
  topCategory,
  onOpenReader
}: PaperDetailViewProps) {
  return (
    <section className="content">
      <div className="page-tabs">
        <div className="tab active">Overview</div>
        <div className="tab">PDF</div>
        <div className="tab">Sections</div>
        <div className="tab">Figures</div>
        <div className="tab">Notes</div>
        <div className="tab">Metadata</div>
      </div>

      <div className="two-col">
        <section className="panel">
          <div className="panel-toolbar">
            <h4>Paper Card</h4>
            <button className="button button-secondary" onClick={onOpenReader} type="button">
              Open Reader
            </button>
          </div>
          <p>{paper.summary}</p>
          <div className="pill-row">
            <div className="pill">{paper.readState}</div>
            {paper.tags.map((tag) => (
              <div className="pill" key={tag}>
                {tag}
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <h4>Status</h4>
          <div className="status-line">
            <span>OCR</span>
            <span className="muted">done</span>
          </div>
          <div className="status-line">
            <span>Vectors</span>
            <span className="muted">ready</span>
          </div>
          <div className="status-line">
            <span>Summary</span>
            <span className="muted">generated</span>
          </div>
          <div className="status-line">
            <span>Category</span>
            <span className="muted">{categoryLabel}</span>
          </div>
          <div className="status-line">
            <span>Color Context</span>
            <span className="muted">{topCategory.color}</span>
          </div>
        </section>
      </div>

      <div className="three-col section-gap">
        <section className="panel">
          <h4>Objective</h4>
          <p>{paper.objective}</p>
        </section>
        <section className="panel">
          <h4>Method</h4>
          <p>{paper.method}</p>
        </section>
        <section className="panel">
          <h4>Main Result</h4>
          <p>{paper.result}</p>
        </section>
      </div>

      <div className="two-col section-gap">
        <section className="panel">
          <h4>Limitation</h4>
          <p>{paper.limitation}</p>
        </section>
        <section className="panel">
          <h4>Metadata</h4>
          <div className="status-line">
            <span>Journal</span>
            <span className="muted">{paper.journal}</span>
          </div>
          <div className="status-line">
            <span>Year</span>
            <span className="muted">{paper.year}</span>
          </div>
          <div className="status-line">
            <span>DOI</span>
            <span className="muted">{paper.doi}</span>
          </div>
        </section>
      </div>
    </section>
  );
}

