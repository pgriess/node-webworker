// Verify that the worker has all global variables.

var assert = require('assert');
var path = require('path');
var sys = require('sys');
var Worker = require('../lib/webworker');

var receivedMsg = false;

var w = new Worker(path.join(__dirname, 'workers', 'globals.js'));

w.onmessage = function(e) {
    assert.ok('data' in e);
    assert.equal(e.data.result, 'ok');

    receivedMsg = true;

    w.terminate();
};

w.onerror = function(e) {
    console.dir(e);

    w.terminate();
};

process.addListener('exit', function() {
    assert.equal(receivedMsg, true);
});
