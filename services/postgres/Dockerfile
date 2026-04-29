FROM pgvector/pgvector:pg16

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        gzip \
        nodejs \
        npm \
    && rm -rf /var/lib/apt/lists/*

COPY scripts/init-db.sh /docker-entrypoint-initdb.d/00-init-db.sh
COPY scripts/import-vectors.sh /usr/local/bin/import-vectors.sh

RUN chmod +x /docker-entrypoint-initdb.d/00-init-db.sh /usr/local/bin/import-vectors.sh
