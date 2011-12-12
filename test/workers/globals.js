var assert = require('assert');

assert.equal(typeof global, 'object');
assert.equal(typeof process, 'object');
assert.equal(typeof console, 'object');
assert.equal(typeof Buffer, 'function');
assert.equal(typeof require, 'function');
assert.equal(typeof require.resolve, 'function');
assert.equal(typeof require.cache, 'object');
assert.equal(typeof __filename, 'string');
assert.equal(typeof __dirname, 'string');
assert.equal(typeof setTimeout, 'function');
assert.equal(typeof clearTimeout, 'function');
assert.equal(typeof setInterval, 'function');
assert.equal(typeof clearInterval, 'function');

assert.equal(typeof postMessage, 'function');

postMessage({ result: 'ok' });
