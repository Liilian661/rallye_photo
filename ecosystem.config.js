module.exports = {
  apps: [
    {
      name: 'rallye-api',
      cwd: '/home/debian/rallye-photo/api',
      script: 'npm',
      args: 'run start',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'rallye-panel',
      cwd: '/home/debian/rallye-photo/panel',
      script: 'npm',
      args: 'run start -- -p 3002',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
