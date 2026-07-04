"""
Docling Table-Parse Sidecar (Tool A/B — tool-ab-adoption slice 02)

Parses a PDF with docling (IBM/LF AI, MIT) and returns a *table-centric* JSON:
table structure (cell grid), per-cell bbox, captions, figure/equation counts,
and parse time. This is a MEASUREMENT-ONLY sidecar for the MinerU-3.4-vs-docling
A/B — the production import pipeline (mineru-client.mjs / main.mjs) is untouched.

Mirrors the FastAPI style of apps/ocr-server/server.py: module-level globals
populated on startup via a lifespan hook, /health + a POST parse endpoint,
Pydantic response models.

Endpoints:
  GET  /health        → model/device status
  POST /parse         → multipart PDF → DoclingDocument summarized as table JSON

Run: uvicorn docling-server:app --host 0.0.0.0 --port 8011
"""

import io
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel

from docling.datamodel.base_models import InputFormat
from docling.document_converter import DocumentConverter

# DocumentStream moved between docling.datamodel.document and docling_core across
# 2.x; import from whichever exposes it so the container start is resilient.
try:
    from docling.datamodel.document import DocumentStream
except ImportError:  # pragma: no cover — version drift fallback
    from docling_core.types.io import DocumentStream

# ---------------------------------------------------------------------------
# Globals (populated on startup)
# ---------------------------------------------------------------------------
converter: DocumentConverter | None = None


def load_converter():
    """Build a DocumentConverter once. docling downloads TableFormer/layout
    models at build time (see Dockerfile.docling), so this is offline."""
    global converter
    print("[docling-server] Building DocumentConverter (PDF)...")
    # Default pipeline enables table structure (TableFormer) + layout.
    converter = DocumentConverter(allowed_formats=[InputFormat.PDF])
    # Warm the models so the first /parse is not penalized by lazy init.
    try:
        converter.initialize_pipeline(InputFormat.PDF)
    except Exception as exc:  # noqa: BLE001 — warmup is best-effort
        print(f"[docling-server] pipeline warmup skipped: {exc}")
    print("[docling-server] DocumentConverter ready.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_converter()
    yield


app = FastAPI(title="Redou Docling Table Sidecar", lifespan=lifespan)


# ---------------------------------------------------------------------------
# Response schemas — table-centric summary of a DoclingDocument
# ---------------------------------------------------------------------------
class Cell(BaseModel):
    text: str
    row: int
    col: int
    row_span: int = 1
    col_span: int = 1
    column_header: bool = False
    row_header: bool = False
    bbox: list[float] | None = None  # [l, t, r, b] in PDF points, or None


class Table(BaseModel):
    index: int
    num_rows: int
    num_cols: int
    caption: str = ""
    caption_ref: str = ""  # e.g. "Table 3" parsed from caption, if any
    page: int | None = None
    html: str = ""
    cells: list[Cell] = []
    cells_with_bbox: int = 0


class Equation(BaseModel):
    index: int
    latex: str
    page: int | None = None


class ParseResponse(BaseModel):
    tables: list[Table]
    equations: list[Equation]
    num_tables: int
    num_figures: int
    num_equations: int
    docling_version: str
    processing_time_ms: float


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _docling_version() -> str:
    try:
        from importlib.metadata import version

        return version("docling")
    except Exception:  # noqa: BLE001
        return "unknown"


def _first_page(prov_list) -> int | None:
    """DoclingDocument provenance is a list of ProvenanceItem; take page_no of
    the first entry (1-based in docling)."""
    if not prov_list:
        return None
    first = prov_list[0]
    page_no = getattr(first, "page_no", None)
    return int(page_no) if page_no is not None else None


def _bbox_of(prov_list) -> list[float] | None:
    """Extract [l, t, r, b] from the first provenance bbox, if present."""
    if not prov_list:
        return None
    bbox = getattr(prov_list[0], "bbox", None)
    if bbox is None:
        return None
    try:
        return [float(bbox.l), float(bbox.t), float(bbox.r), float(bbox.b)]
    except Exception:  # noqa: BLE001
        return None


def _parse_caption_ref(caption: str) -> str:
    """"Table 3. Isotherm parameters" → "Table 3" (for A/B caption-linking axis)."""
    import re

    m = re.search(r"tab(?:le)?\.?\s*(\d+)", caption, flags=re.IGNORECASE)
    return f"Table {m.group(1)}" if m else ""


def summarize_table(index: int, tbl, document) -> Table:
    """Turn a docling TableItem into our table-centric summary (grid + bbox)."""
    data = getattr(tbl, "data", None)

    num_rows = int(getattr(data, "num_rows", 0) or 0)
    num_cols = int(getattr(data, "num_cols", 0) or 0)

    cells: list[Cell] = []
    cells_with_bbox = 0
    for tc in getattr(data, "table_cells", []) or []:
        bbox = None
        raw_bbox = getattr(tc, "bbox", None)
        if raw_bbox is not None:
            try:
                bbox = [float(raw_bbox.l), float(raw_bbox.t), float(raw_bbox.r), float(raw_bbox.b)]
            except Exception:  # noqa: BLE001
                bbox = None
        if bbox is not None:
            cells_with_bbox += 1
        cells.append(
            Cell(
                text=str(getattr(tc, "text", "") or ""),
                row=int(getattr(tc, "start_row_offset_idx", 0) or 0),
                col=int(getattr(tc, "start_col_offset_idx", 0) or 0),
                row_span=int(getattr(tc, "row_span", 1) or 1),
                col_span=int(getattr(tc, "col_span", 1) or 1),
                column_header=bool(getattr(tc, "column_header", False)),
                row_header=bool(getattr(tc, "row_header", False)),
                bbox=bbox,
            )
        )

    # HTML export (structure) — tolerate signature differences across versions.
    html = ""
    try:
        html = tbl.export_to_html(doc=document)
    except TypeError:
        try:
            html = tbl.export_to_html()
        except Exception:  # noqa: BLE001
            html = ""
    except Exception:  # noqa: BLE001
        html = ""

    caption = ""
    try:
        caption = tbl.caption_text(document) or ""
    except Exception:  # noqa: BLE001
        caption = ""

    return Table(
        index=index,
        num_rows=num_rows,
        num_cols=num_cols,
        caption=caption.strip(),
        caption_ref=_parse_caption_ref(caption),
        page=_first_page(getattr(tbl, "prov", None)),
        html=html,
        cells=cells,
        cells_with_bbox=cells_with_bbox,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    return {
        "status": "ok" if converter is not None else "loading",
        "service": "docling-table-sidecar",
        "docling": _docling_version(),
    }


@app.post("/parse", response_model=ParseResponse)
async def parse(file: UploadFile = File(...)):
    """Parse a PDF and return a table-centric summary of the DoclingDocument."""
    if converter is None:
        raise HTTPException(503, "Converter not loaded yet")

    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file")

    t0 = time.perf_counter()
    stream = DocumentStream(name=file.filename or "input.pdf", stream=io.BytesIO(raw))
    try:
        result = converter.convert(stream)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"docling convert failed: {exc}") from exc
    document = result.document
    elapsed_ms = (time.perf_counter() - t0) * 1000

    tables = [summarize_table(i, tbl, document) for i, tbl in enumerate(document.tables or [])]

    # Equations: docling emits TextItem with label "formula"; latex when available.
    equations: list[Equation] = []
    for idx, item in enumerate(getattr(document, "texts", []) or []):
        label = getattr(item, "label", None)
        label_str = getattr(label, "value", label)
        if label_str == "formula":
            latex = str(getattr(item, "text", "") or "").strip()
            if latex:
                equations.append(
                    Equation(index=idx, latex=latex, page=_first_page(getattr(item, "prov", None)))
                )

    return ParseResponse(
        tables=tables,
        equations=equations,
        num_tables=len(tables),
        num_figures=len(getattr(document, "pictures", []) or []),
        num_equations=len(equations),
        docling_version=_docling_version(),
        processing_time_ms=round(elapsed_ms, 1),
    )
