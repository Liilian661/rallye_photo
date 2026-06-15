import axios from 'axios';
import Cookies from 'js-cookie';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'https://api.rallye-photo.com',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add access token to every request
api.interceptors.request.use((config) => {
  const token = Cookies.get('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle token refresh on 401
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && error.response?.data?.code === 'TOKEN_EXPIRED' && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = Cookies.get('refreshToken');
        if (!refreshToken) {
          window.location.href = '/auth/login';
          return Promise.reject(error);
        }

        const { data } = await axios.post(
          `${process.env.NEXT_PUBLIC_API_URL || 'https://api.rallye-photo.com'}/auth/refresh`,
          { refreshToken }
        );

        Cookies.set('accessToken', data.accessToken, { expires: 1 });
        Cookies.set('refreshToken', data.refreshToken, { expires: 30 });

        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        Cookies.remove('accessToken');
        Cookies.remove('refreshToken');
        Cookies.remove('user');
        window.location.href = '/auth/login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
