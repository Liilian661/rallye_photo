#!/bin/bash
set -e
echo "Deploiement Rallye Photo"
cd ~/rallye-photo
echo "Build API..."
cd api && npm run build && cd ..
echo "Build Panel..."
cd panel && npm run build && cd ..
echo "Build App..."
cd app && npm run build && cd ..
echo "Build Admin..."
cd admin && npm run build && cd ..
echo "Restart services..."
pm2 restart all
pm2 save
echo "Deploiement termine !"
pm2 status
