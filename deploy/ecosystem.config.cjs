module.exports = {
  apps: [{
    name: 'th79-hrm-api',
    script: 'src/server.js',
    cwd: __dirname + '/..',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '700M',
    env: { NODE_ENV: 'production' }
  }]
};
