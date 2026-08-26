module.exports = function (api) {
  // Not api.cache(true) — plugins below reads NODE_ENV, so the cache key must too,
  // or a dev-time compile (plugins: []) gets reused for a production build.
  api.cache.using(() => process.env.NODE_ENV);
  return {
    presets: ['babel-preset-expo'],
    // Strip console.* from release builds — see
    // leash-remover-api/docs/security-design-2026-08-25.md C-5: nothing
    // logged in dev should ship in a build a reviewer or a user can inspect.
    plugins: process.env.NODE_ENV === 'production' ? ['transform-remove-console'] : [],
  };
};
