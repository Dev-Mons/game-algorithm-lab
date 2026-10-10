import { defineConfig } from 'vitest/config';
export default defineConfig({
  base: './',
  plugins: [{
    name: 'skill-tree-source-identity',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__skill_tree_source', (_request, response) => {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end(JSON.stringify({ app: 'skill-tree-studio', protocol: 1, root: server.config.root }));
      });
    },
  }],
  test: { include: ['tests/unit/**/*.test.ts'] },
});
