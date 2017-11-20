const { NODE_ENV } = process.env;
const pkg = require('./package.json');

module.exports = {
  presets: [
    ['babel-preset-env', {
      targets: {
        node: NODE_ENV === 'development' ? 'current' : pkg.engines.node.match(/[0-9.]+/),
      },
    }]
  ],
  plugins: [
    'babel-plugin-transform-runtime',
    'babel-plugin-transform-object-rest-spread',
  ],
};
