"""
LangExtract Stage-3b Sidecar (Tool A/B — tool-ab-adoption slice 04)

Runs Google LangExtract (Apache-2.0, model-free wheel, Ollama backend) as an
ALTERNATIVE Stage-3b extractor and returns each extraction with its source
character offset (grounding). This is a MEASUREMENT-ONLY sidecar for the
current-SRAG-vs-LangExtract A/B — the production chat/extraction pipeline
(chat/table-pipeline.mjs / chat/table-extraction.mjs / main.mjs) is untouched.

Mirrors the FastAPI style of apps/ocr-server/server.py and apps/docling-server
(slice 02): a module-level backend probe, /health + a POST /extract endpoint,
Pydantic request/response models. LangExtract's Python API drifts across 1.x
(model_url vs base_url, char_interval vs char_offset, data.ExampleData layout),
so every attribute is read via getattr/try-except like docling-server.py does.

LangExtract is model-free: the wheel ships no weights. It calls a local Ollama
model (default gemma4:31b, the A/B baseline LLM) over its OpenAI-ish /api. We
point it at host.docker.internal:11434 by default so the container reuses the
existing Ollama stack (no new model download).

Endpoints:
  GET  /health   → langextract version + configured Ollama backend
  POST /extract  → { text, prompt_description?, examples[], model_id?, ... }
                   → { extractions:[{property,value,unit,condition,extraction_class,
                       extraction_text,char_start,char_end,alignment_status,...}] }

Run: uvicorn langextract-server:app --host 0.0.0.0 --port 8012
"""

import os
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

# LangExtract is imported lazily inside the endpoint so the container can start
# (and /health can report "loading"/"error") even if the wheel/model backend has
# a problem — matching docling-server's resilient-start posture.
try:
    import langextract as lx  # noqa: F401  (probed at import; used in /extract)

    _LX_IMPORT_ERROR: str | None = None
except Exception as exc:  # noqa: BLE001 — report at /health instead of crashing boot
    lx = None  # type: ignore[assignment]
    _LX_IMPORT_ERROR = str(exc)

# ---------------------------------------------------------------------------
# Backend config (Ollama). Overridable via env so the A/B can point at whatever
# host runs the baseline model. Defaults reuse the always-on local Ollama.
# ---------------------------------------------------------------------------
OLLAMA_URL = os.environ.get("REDOU_LANGEXTRACT_OLLAMA_URL", "http://host.docker.internal:11434")
DEFAULT_MODEL_ID = os.environ.get("REDOU_LANGEXTRACT_MODEL", "gemma4:31b")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if _LX_IMPORT_ERROR:
        print(f"[langextract-server] WARNING: langextract import failed: {_LX_IMPORT_ERROR}")
    else:
        print(f"[langextract-server] langextract {_langextract_version()} ready; "
              f"Ollama backend {OLLAMA_URL}, default model {DEFAULT_MODEL_ID}")
    yield


app = FastAPI(title="Redou LangExtract Stage-3b Sidecar", lifespan=lifespan)


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------
class ExampleExtraction(BaseModel):
    """One few-shot extraction inside an example: which class, the exact span of
    source text, and its structured attributes (property/value/unit/condition)."""

    extraction_class: str
    extraction_text: str
    attributes: dict[str, Any] = Field(default_factory=dict)


class Example(BaseModel):
    """A few-shot ExampleData: a snippet of text + the extractions expected from it."""

    text: str
    extractions: list[ExampleExtraction] = Field(default_factory=list)


class ExtractRequest(BaseModel):
    text: str
    prompt_description: str = ""
    examples: list[Example] = Field(default_factory=list)
    model_id: str | None = None
    # LangExtract chunking / multi-pass knobs (all optional; sensible defaults).
    max_char_buffer: int = 6000
    extraction_passes: int = 1
    max_workers: int = 4
    temperature: float = 0.0
    # gemma-via-Ollama wraps JSON in ```json fences on real chunks; strip them.
    fence_output: bool = True


class Extraction(BaseModel):
    extraction_class: str
    extraction_text: str
    # Flattened well-known attributes for the A/B (property/value/unit/condition),
    # plus the raw attributes dict so nothing is lost.
    property: str = ""
    value: str = ""
    unit: str = ""
    condition: str = ""
    attributes: dict[str, Any] = Field(default_factory=dict)
    # Grounding: char offsets into the submitted text (D3 provenance axis).
    char_start: int | None = None
    char_end: int | None = None
    alignment_status: str = ""


class ExtractResponse(BaseModel):
    extractions: list[Extraction]
    num_extractions: int
    grounded_extractions: int  # extractions carrying a resolved char offset
    model_id: str
    langextract_version: str
    processing_time_ms: float


# ---------------------------------------------------------------------------
# Helpers (LangExtract 1.x attribute drift — read everything defensively)
# ---------------------------------------------------------------------------
def _langextract_version() -> str:
    try:
        from importlib.metadata import version

        return version("langextract")
    except Exception:  # noqa: BLE001
        return "unknown"


def _build_examples(examples: list[Example]) -> list[Any]:
    """Turn our JSON examples into lx.data.ExampleData/Extraction objects."""
    built: list[Any] = []
    for ex in examples:
        extractions = []
        for e in ex.extractions:
            extractions.append(
                lx.data.Extraction(
                    extraction_class=e.extraction_class,
                    extraction_text=e.extraction_text,
                    attributes=dict(e.attributes or {}),
                )
            )
        built.append(lx.data.ExampleData(text=ex.text, extractions=extractions))
    return built


def _char_interval(extraction: Any) -> tuple[int | None, int | None]:
    """Read [start, end) source char offsets across 1.x layouts:
    .char_interval.start_pos/.end_pos (current) or a flat .char_start/.char_end."""
    interval = getattr(extraction, "char_interval", None)
    if interval is not None:
        start = getattr(interval, "start_pos", None)
        end = getattr(interval, "end_pos", None)
        if start is not None or end is not None:
            return (
                int(start) if start is not None else None,
                int(end) if end is not None else None,
            )
    start = getattr(extraction, "char_start", None)
    end = getattr(extraction, "char_end", None)
    return (
        int(start) if start is not None else None,
        int(end) if end is not None else None,
    )


def _alignment_status(extraction: Any) -> str:
    status = getattr(extraction, "alignment_status", None)
    # It may be an enum (with .value) or a plain string.
    return str(getattr(status, "value", status) or "")


def _run_extract(req: ExtractRequest) -> Any:
    """Call langextract.extract with the Ollama backend, tolerating the two ways
    1.x has spelled the local-model base URL (model_url vs base_url) and the
    Ollama-specific flags (fence_output / use_schema_constraints)."""
    model_id = req.model_id or DEFAULT_MODEL_ID
    examples = _build_examples(req.examples)

    common = dict(
        text_or_documents=req.text,
        prompt_description=req.prompt_description,
        examples=examples,
        model_id=model_id,
        max_char_buffer=req.max_char_buffer,
        extraction_passes=req.extraction_passes,
        max_workers=req.max_workers,
        temperature=req.temperature,
        # Ollama serves plain text (no OpenAI function-calling); LangExtract's
        # docs disable schema constraints for local models. gemma wraps its
        # JSON in ```json fences on real-size chunks (the parse errors "char 1
        # column 2" are the backtick), so fence stripping must stay ON.
        fence_output=req.fence_output,
        use_schema_constraints=False,
    )

    # LangExtract renamed the local-model URL kwarg between releases. Try the
    # current name first, then the older one, then no URL (env-config) — never
    # let a kwarg mismatch masquerade as an extraction failure.
    for url_kwarg in ("model_url", "base_url"):
        try:
            return lx.extract(**common, **{url_kwarg: OLLAMA_URL})
        except TypeError as exc:
            if url_kwarg in str(exc) or "unexpected keyword" in str(exc):
                continue
            raise
    # Last resort: let langextract read its own env (LANGEXTRACT_* / OLLAMA host).
    return lx.extract(**common)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    return {
        "status": "error" if _LX_IMPORT_ERROR else "ok",
        "service": "langextract-stage3b-sidecar",
        "langextract": _langextract_version(),
        "ollama_url": OLLAMA_URL,
        "default_model": DEFAULT_MODEL_ID,
        "import_error": _LX_IMPORT_ERROR,
    }


@app.post("/extract", response_model=ExtractResponse)
def extract(req: ExtractRequest):
    if _LX_IMPORT_ERROR or lx is None:
        raise HTTPException(503, f"langextract unavailable: {_LX_IMPORT_ERROR}")
    if not req.text or not req.text.strip():
        raise HTTPException(400, "Empty text")

    model_id = req.model_id or DEFAULT_MODEL_ID
    t0 = time.perf_counter()
    try:
        result = _run_extract(req)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"langextract failed: {exc}") from exc
    elapsed_ms = (time.perf_counter() - t0) * 1000

    out: list[Extraction] = []
    grounded = 0
    for ex in getattr(result, "extractions", []) or []:
        attributes = dict(getattr(ex, "attributes", None) or {})
        char_start, char_end = _char_interval(ex)
        if char_start is not None:
            grounded += 1
        # Pull the well-known adsorption fields out of attributes; keep the raw
        # dict too so nothing is dropped for the A/B report.
        out.append(
            Extraction(
                extraction_class=str(getattr(ex, "extraction_class", "") or ""),
                extraction_text=str(getattr(ex, "extraction_text", "") or ""),
                property=str(attributes.get("property", "") or ""),
                value=str(attributes.get("value", "") or ""),
                unit=str(attributes.get("unit", "") or ""),
                condition=str(attributes.get("condition", "") or ""),
                attributes=attributes,
                char_start=char_start,
                char_end=char_end,
                alignment_status=_alignment_status(ex),
            )
        )

    return ExtractResponse(
        extractions=out,
        num_extractions=len(out),
        grounded_extractions=grounded,
        model_id=model_id,
        langextract_version=_langextract_version(),
        processing_time_ms=round(elapsed_ms, 1),
    )
