# ─── Stage 1: build del panel Vue ────────────────────────────
FROM node:20-alpine AS admin-builder
WORKDIR /app/admin
COPY admin/package*.json ./
RUN npm ci
COPY admin/ ./
RUN npm run build

# ─── Stage 2: runtime del bot ────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src/ ./src/
COPY config/ ./config/

# Copiar el build del panel desde el stage anterior
COPY --from=admin-builder /app/admin/dist ./admin/dist

EXPOSE 3000

CMD ["node", "src/index.js"]
