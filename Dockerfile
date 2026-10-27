FROM node:22.14.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core fonts-liberation && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit && npm cache clean --force
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node resources ./resources
COPY --chown=node:node scripts/setup.js ./scripts/setup.js
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV APP_HOST=0.0.0.0 DATA_DIR=/app/data PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s CMD node -e "fetch('http://127.0.0.1:3000/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","src/server.js"]
