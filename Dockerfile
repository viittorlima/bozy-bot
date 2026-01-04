# Node.js API Dockerfile
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY . .

# Expose port
EXPOSE 3000

# Start the app
CMD ["npm", "start"]
