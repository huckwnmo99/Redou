import type { PaperRecord, TopCategory } from "../types";

interface LibraryViewProps {
  topCategory: TopCategory;
  subCategoryName: string;
  papers: PaperRecord[];
  onOpenPaper: (paperId: string) => void;
  onOpenReader: (paperId: string) => void;
}

export function LibraryView({
  topCategory,
  subCategoryName,
  papers,
  onOpenPaper,
  onOpenReader
}: LibraryViewProps) {
  return (
    <section className="content">
      <div className="hero">
        <div>
          <h3>사용자 정의 카테고리 라이브러리</h3>
          <p>
            선택된 하위 카테고리를 기준으로 논문을 보고, 카드에서 바로 상세 화면이나
            리더로 이동합니다.
          </p>
        </div>
        <div className="pill-row">
          <div className="pill">Category: {topCategory.name}</div>
          <div className="pill">Sub: {subCategoryName}</div>
          <div className="pill">Cards: {papers.length}</div>
        </div>
      </div>

      <div className="card-grid">
        {papers.map((paper) => (
          <article className="paper-card" key={paper.id}>
            <div className="card-topline">
              <span className="chip">{paper.readState}</span>
              <span className="meta">{paper.journal}</span>
            </div>
            <h4>{paper.title}</h4>
            <p>{paper.summary}</p>
            <div className="card-meta">
              <span>{paper.year}</span>
              <span>{paper.noteCount} notes</span>
              <span>{paper.highlightCount} highlights</span>
              <span>{paper.figureCount} figures</span>
            </div>
            <div className="pill-row">
              {paper.tags.slice(0, 4).map((tag) => (
                <span className="pill" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
            <div className="card-actions">
              <button className="button" onClick={() => onOpenPaper(paper.id)} type="button">
                Open Detail
              </button>
              <button
                className="button button-secondary"
                onClick={() => onOpenReader(paper.id)}
                type="button"
              >
                Open Reader
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

