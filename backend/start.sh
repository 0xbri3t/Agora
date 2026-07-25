#!/bin/bash

echo "Starting FutarFi API Docker services..."

# Start services
docker-compose up -d

# Show status
echo "Container status:"
docker-compose ps

echo ""
echo "Docker services started!"
echo "API: http://localhost:3001"
echo "MongoDB: localhost:27017"
echo ""
echo "Commands:"
echo "  docker-compose logs -f     - View logs"
echo "  docker-compose ps          - Check status"
echo "  ./stop.sh                  - Stop services"
