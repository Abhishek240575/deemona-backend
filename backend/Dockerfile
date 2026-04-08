FROM node:20-alpine

LABEL maintainer="Deemona Finance Solution"
LABEL description="Real-Time Financial Intelligence Platform"

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY . .

# Expose ports
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/v1/health || exit 1

# Start server
CMD ["node", "src/server.js"]
