import type { PaperRecord, TopCategory } from "../types";

interface CategoryViewProps {
  topCategory: TopCategory;
  subCategoryName: string;
  subCategoryNote: string;
  papers: PaperRecord[];
}

export function CategoryView({
  topCategory,
  subCategoryName,
  subCategoryNote,
  papers
}: CategoryViewProps) {
  const totalNotes = papers.reduce((sum, paper) => sum + paper.noteCount, 0);
  const totalFigures = papers.reduce((sum, paper) => sum + paper.figureCount, 0);
  const importantCount = papers.filter((paper) => paper.readState === "important").length;

  return (
    <section className="content">
      <div className="three-col">
        <section className="panel">
          <h4>Category Summary</h4>
          <div className="status-line">
            <span>Top Category</span>
            <span className="muted">{topCategory.name}</span>
          </div>
          <div className="status-line">
            <span>Sub Category</span>
            <span className="muted">{subCategoryName}</span>
          </div>
          <div className="status-line">
            <span>Papers</span>
            <span className="muted">{papers.length}</span>
          </div>
          <div className="status-line">
            <span>Important Papers</span>
            <span className="muted">{importantCount}</span>
          </div>
          <div className="status-line">
            <span>Linked Notes</span>
            <span className="muted">{totalNotes}</span>
          </div>
          <div className="status-line">
            <span>Saved Figures</span>
            <span className="muted">{totalFigures}</span>
          </div>
        </section>

        <section className="panel">
          <h4>Papers in Category</h4>
          <div className="list">
            {papers.map((paper) => (
              <div className="result-card" key={paper.id}>
                <h4>{paper.title}</h4>
                <p>{paper.summary}</p>
                <div className="meta-row">
                  <span>{paper.readState}</span>
                  <span>{paper.noteCount} notes</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <h4>Category Note</h4>
          <p>{subCategoryNote}</p>
          <p className="muted category-note">
            상위 카테고리 설명: {topCategory.note}
          </p>
        </section>
      </div>
    </section>
  );
}

