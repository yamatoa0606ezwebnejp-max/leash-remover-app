module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Strip console.* from release builds — see
    // leash-remover-api/docs/security-design-2026-08-25.md C-5: nothing
    // logged in dev should ship in a build a reviewer or a user can inspect.
    plugins: process.env.NODE_ENV === 'production' ? ['transform-remove-console'] : [],
  };
};
