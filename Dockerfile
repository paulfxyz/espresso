FROM node:20-alpine AS builder

# sharp requires vips at build time for native bindings
RUN apk add --no-cache vips-dev python3 make g++

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

# sharp requires vips at runtime
RUN apk add --no-cache vips

# Install production deps only
COPY package*.json ./
RUN npm ci --only=production

# Copy built output
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/shared ./shared

# Create data directory for SQLite
RUN mkdir -p /data

ENV NODE_ENV=production
ENV DB_PATH=/data/espresso.db
ENV PORT=5000

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:5000/api/health || exit 1

CMD ["node", "dist/index.cjs"]
