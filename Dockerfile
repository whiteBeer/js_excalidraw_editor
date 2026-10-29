FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY editor ./editor
COPY vite.config.js ./
RUN npm run build

FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs merge.mjs ./
COPY public ./public
COPY --from=build /app/dist ./dist
EXPOSE 3010
CMD ["node", "server.mjs"]
