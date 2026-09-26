import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 4273,headers:{'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'} },
  preview:{headers:{'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}},
  plugins: [{
    name: 'crowd-source-identity',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__crowd_source', (_request, response) => {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end(JSON.stringify({ app: 'crowd-navigation-lab', protocol: 1, root: server.config.root }));
      });
    },
  }],
  build: {
    rollupOptions: {
      input: {main: 'index.html', research: 'experiments/fluid-navigation/index.html'},
    },
  },
  test: {
    exclude: ['tests/browser/**', 'node_modules/**', 'dist/**'],
  },
});
