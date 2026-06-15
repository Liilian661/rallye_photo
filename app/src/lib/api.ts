import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'https://api.rallye-photo.com',
  headers: {
    'Content-Type': 'application/json',
  },
});

export default api;
