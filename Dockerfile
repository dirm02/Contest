FROM node:22-slim AS frontend-build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src

ARG VITE_SHIP_API_BASE_URL=/ship-api
ENV VITE_SHIP_API_BASE_URL=${VITE_SHIP_API_BASE_URL}

RUN npm run build

FROM nginx:1.27-alpine

COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=frontend-build /app/dist /usr/share/nginx/html

EXPOSE 8080
