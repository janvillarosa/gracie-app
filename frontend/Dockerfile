# syntax=docker/dockerfile:1

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml* .npmrc* ./
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
# Install dependencies (no lockfile required in CI build)
RUN pnpm install --frozen-lockfile=false
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN pnpm build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
