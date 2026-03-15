FROM node:20-alpine

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Bundle app source
COPY . .

# Expose the port Cloud Run expects
EXPOSE 8080

# Start the server
CMD [ "node", "server.js" ]
