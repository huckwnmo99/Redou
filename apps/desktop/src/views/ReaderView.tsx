import type { AnnotationPreset, PaperRecord } from "../types";

interface ReaderViewProps {
  paper: PaperRecord;
  categoryLabel: string;
  presets: AnnotationPreset[];
}

export function ReaderView({ paper, categoryLabel, presets }: ReaderViewProps) {
  return (
    <section className="content">
      <div className="two-col reader-layout">
        <section className="panel reader-panel">
          <div className="panel-toolbar">
            <h4>PDF Reader</h4>
            <div className="pill-row">
              <div className="pill">Detach Notes</div>
              <div className="pill">Reader Focus</div>
            </div>
          </div>

          <div className="reader-sheet">
            <p>The layered bed configuration delayed the onset of carbon dioxide penetration into the zeolite layer.</p>
            <p>
              <span className="highlight highlight-teal">
                This protection effect increased hydrogen purity stability during the adsorption step.
              </span>
            </p>
            <p>
              <span className="highlight highlight-pink">
                Recovery decreased at higher adsorption pressure, suggesting a trade-off with cycle timing.
              </span>
            </p>
            <p>
              <span className="highlight highlight-blue">
                This paragraph should support the mechanism explanation in the thesis introduction.
              </span>
            </p>
          </div>
        </section>

        <section className="panel">
          <h4>Annotation Categories</h4>
          <div className="nav-list annotation-list">
            {presets.map((preset) => (
              <div className="nav-item" key={preset.id}>
                <span className={`dot ${preset.colorClass}`} />
                {preset.name}
              </div>
            ))}
          </div>

          <h4 className="subsection-title">Linked Notes</h4>
          <div className="list">
            <div className="result-card">
              <h4>Important result</h4>
              <p>Use this paragraph when explaining why layered beds are worth the complexity.</p>
            </div>
            <div className="result-card">
              <h4>Question</h4>
              <p>Need to verify whether the pressure trade-off also appears in Lee 2024.</p>
            </div>
            <div className="result-card">
              <h4>Category context</h4>
              <p>
                This paper is currently linked to {categoryLabel} and carries {paper.highlightCount} saved highlights.
              </p>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

