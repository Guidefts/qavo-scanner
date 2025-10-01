# Use the official Playwright image which has all browsers and dependencies
FROM mcr.microsoft.com/playwright:v1.55.1-jammy

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json (if it exists)
COPY package*.json ./

# Install application dependencies
RUN npm install

# Copy the rest of your application's code
COPY . .

# Build your TypeScript code
RUN npm run build

# Expose the port your app runs on
EXPOSE 8080

# Command to run your application
CMD ["npm", "start"]
