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

# Container serves at root by default. Override at build time for a
# path-prefixed deploy (e.g. behind a reverse proxy at /factorio/).
ARG VITE_BASE=/
ENV VITE_BASE=${VITE_BASE}
RUN cd app && npm run build

# ---- Stage 2: serve with nginx ----
FROM nginx:1.27-alpine
COPY --from=builder /src/app/dist /usr/share/nginx/html
EXPOSE 80
