#!/bin/bash

echo "Setting up FutarFi API with Docker..."


# Install dependencies
pnpm install

# Clean up and start
docker-compose down -v 2>/dev/null
docker-compose up -d --build

echo "Docker setup complete!"
echo "API: http://localhost:3001"
