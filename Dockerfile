# WebNail generation server — Ollama (llava:13b) + Node API, single container.
#
# Render deploys this as a Docker web service. CPU-only: llava:13b is slow
# on CPU (often 1-3+ minutes per generation depending on instance size), so
# the API is async — see src/index.js. Pick a Render instance with at least
# 8GB RAM; more is better for 13B.

FROM node:20-slim AS base

# ---- Install Ollama ----
RUN apt-get update && apt-get install -y curl ca-certificates && \
    curl -fsSL https://ollama.com/install.sh | sh && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

ENV OLLAMA_HOST=0.0.0.0:11434
ENV OLLAMA_MODELS=/data/ollama-models
ENV WEBNAIL_MODEL=llava:13b

# ---- Pre-pull the model at build time so it's baked into the image ----
# (avoids a multi-GB download on every cold start / deploy)
RUN mkdir -p /data/ollama-models && \
    (ollama serve &) && \
    sleep 5 && \
    ollama pull ${WEBNAIL_MODEL} && \
    pkill ollama

# ---- Node API ----
WORKDIR /app
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev
COPY server/src ./src
COPY server/start.sh ./start.sh
RUN chmod +x ./start.sh

EXPOSE 10000
ENV PORT=10000

CMD ["./start.sh"]
