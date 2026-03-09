FROM python:3.11-slim

WORKDIR /app

# Install system deps for Scrapling browser support
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install browsers for Scrapling
RUN scrapling install || true

COPY server.py .

EXPOSE 8900

CMD ["python", "server.py"]
