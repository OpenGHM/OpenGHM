FROM python:3.12-slim

WORKDIR /app

# git is required to install slurmly from GitHub
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# Install dependencies first (layer cache)
COPY web-gateway/backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY web-gateway/backend/ .

EXPOSE 8100

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8100"]
