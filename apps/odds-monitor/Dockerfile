FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_ODDS_SERVICE_URL=/api
ENV VITE_ODDS_SERVICE_URL=$VITE_ODDS_SERVICE_URL
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
COPY server.mjs ./server.mjs
EXPOSE 3000
CMD ["npm", "start"]
