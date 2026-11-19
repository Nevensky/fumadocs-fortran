# FORD as a development-time oracle (never shipped): scripts/oracle/ford.sh builds and runs this image.
FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends cpp && rm -rf /var/lib/apt/lists/*
ARG FORD_VERSION=7.0.13
RUN python -m venv /opt/ford && /opt/ford/bin/pip install --no-cache-dir "ford==${FORD_VERSION}"
ENV PATH=/opt/ford/bin:$PATH
