# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci
COPY . .
RUN npm run build -w web

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci --omit=dev
COPY server ./server
COPY --from=build /app/web/dist ./web/dist
EXPOSE 8787
# Render/Fly inject PORT; mlx/local can override with RT_PORT.
CMD ["node", "server/src/index.js"]
