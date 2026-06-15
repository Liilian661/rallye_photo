import axios from 'axios';
import Cookies from 'js-cookie';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'https://api.rallye-photo.com',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = Cookies.get('adminAccessToken');
  if (token) {
    config.headers.Authorization = 'Bearer ' + token;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && error.response?.data?.code === 'TOKEN_EXPIRED' && !original._retry) {
      original._retry = true;
      try {
        const refreshToken = Cookies.get('adminRefreshToken');
        const { data } = await axios.post(
          (process.env.NEXT_PUBLIC_API_URL || 'https://api.rallye-photo.com') + '/auth/refresh',
          { refreshToken }
        );
        Cookies.set('adminAccessToken', data.accessToken, { expires: 1 });
        Cookies.set('adminRefreshToken', data.refreshToken, { expires: 30 });
        original.headers.Authorization = 'Bearer ' + data.accessToken;
        return api(original);
      } catch {
        Cookies.remove('adminAccessToken');
        Cookies.remove('adminRefreshToken');
        Cookies.remove('adminUser');
        window.location.href = '/auth/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
