FROM node:22-slim

ENV NODE_ENV=production \
    PORT=3801

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3801

CMD ["npm", "run", "entities:dossier"]
