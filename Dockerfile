FROM node:20-slim

# Install ffmpeg (for voice transcription) + curl + ca-certificates
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application source
COPY . .

# Create persistent storage directory
RUN mkdir -p /app/data

EXPOSE 7860

CMD ["npm", "start"]
