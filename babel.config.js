module.exports = function(api) {
  api.cache(true);
  return {
    // babel-preset-expo v54+ auto-includes react-native-reanimated/plugin
    // when the package is present in node_modules. Don't add it again here
    // or it'll be invoked twice and emit duplicate worklet init data.
    presets: [['babel-preset-expo', { reanimated: true }]],
  };
};
