# syntax=docker/dockerfile:1.7

# ---- Stage 1: build the React app ----
FROM node:24-alpine AS builder
WORKDIR /src

# Install app deps first so layer caches independently of source edits.
COPY app/package.json app/package-lock.json ./app/
RUN cd app && npm ci

# Copy the rest of the repo. The app's public/ has symlinks into the
# parent repo's data/ and images/ — vite resolves them at build time.
COPY . .

# Default to serving at root inside the container; override at build
# time when targeting a path-prefixed deploy (e.g. GitHub project pages).
ARG VITE_BASE=/app/
ENV VITE_BASE=${VITE_BASE}
RUN cd app && npm run build

# Assemble the composed site: legacy kirkmcdonald static files at /,
# the React app at /app/.
RUN mkdir -p /out && \
    cp -R /src/. /out/ && \
    rm -rf /out/app /out/.git /out/.github /out/.beads /out/.claude \
           /out/.playwright-mcp /out/.dolt /out/.agents /out/.codex \
           /out/scripts /out/docs /out/posts /out/node_modules && \
    mkdir -p /out/app && \
    cp -R /src/app/dist/. /out/app/

# ---- Stage 2: serve with nginx ----
FROM nginx:1.27-alpine
COPY --from=builder /out /usr/share/nginx/html
EXPOSE 80
