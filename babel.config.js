module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // NOTE: reanimated/plugin removed — no worklets used in codebase.
    // If reanimated worklets (useSharedValue, withTiming, etc.) are added back,
    // re-enable this plugin.
  };
};
