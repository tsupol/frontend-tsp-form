FROM node:22-alpine AS build
WORKDIR /app
# --ignore-scripts: the postinstall hook (copyPdfjsAssets.mjs) needs ./scripts,
# which isn't copied until the next layer. `npm run build` runs it anyway.
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
