// Verify that attempting to create a SharedWorker by a name and source
// that already exists works as expected (i.e. we get a handle to the
// same instance).

var assert = require('assert');
var path = require('path');
var SharedWorker = require('../lib').SharedWorker;
var sys = require('sys');

var startsWith = function(str1, str2) {
    return (str1.length >= str2.length) &&
           (str1.substring(0, str2.length) === str2);
};

var workerPath = path.join(__dirname, 'workers', 'shared-cached.js');
var workerName = 'Pierre Laclede';

var sw = new SharedWorker(workerPath, workerName);

// Attempt to create a shared worker with a mismatched name
var f = function(wn) {
    try {
        new SharedWorker(workerPath, wn);
        assert.ok(false, 'Expected execption');
    } catch (e) {
        assert.ok(startsWith(e.message, 'Shared worker with src'));
    }
};
f(workerName + 'qq');
f(undefined);
f('');

// Attempt to create a worker with a mismatched source
var f = function(wp) {
    try {
        new SharedWorker(wp, workerName);
        assert.ok(false, 'Expected execption');
    } catch (e) {
        assert.ok(startsWith(e.message, 'Shared worker with src'));
    }
};
f(workerPath + 'qq');
f(undefined);
f('');

sw.terminate();
