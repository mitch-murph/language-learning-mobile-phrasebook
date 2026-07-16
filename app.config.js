// GitHub Pages serves this repo from /language-learning-mobile-phrasebook/, not /.
// Only the web export needs asset paths rewritten for that; native builds (npm run
// apk) never set EXPO_WEB_BASE_URL, so Android is unaffected.
module.exports = ({ config }) => {
  if (!process.env.EXPO_WEB_BASE_URL) return config;
  return {
    ...config,
    experiments: {
      ...config.experiments,
      baseUrl: process.env.EXPO_WEB_BASE_URL,
    },
  };
};
