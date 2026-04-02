FROM nvidia/cuda:12.8.0-cudnn-runtime-ubuntu22.04

WORKDIR /app

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 python3-pip python3.10-venv \
    libgl1-mesa-glx libglib2.0-0 git git-lfs curl \
    && ln -sf /usr/bin/python3.10 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

# Install PyTorch nightly with CUDA 12.8 (Blackwell sm_120 support)
RUN pip install --no-cache-dir \
    torch torchvision --index-url https://download.pytorch.org/whl/cu128

# Install remaining Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download UniMERNet base model at build time
RUN python -c "\
from huggingface_hub import snapshot_download; \
snapshot_download('wanderkid/unimernet_base', local_dir='/app/models/unimernet_base')"

# Copy server code and config
COPY server.py .
COPY config.yaml .

EXPOSE 8010

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8010"]
