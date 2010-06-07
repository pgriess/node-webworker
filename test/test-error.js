// Verify that the parent process sees uncaught exceptions from workers.

var assert = require('assert');
var path = require('path');
var Worker = require('webworker').Worker;

var w = new Worker(path.join(__dirname, 'workers', 'error.js'));

var receivedError = false;
w.onerror = function(e) {
    assert.equal(5, e.lineno);
    assert.equal('AssertionError: true == false', e.message);

    receivedError = true;
    w.terminate();
};

process.addListener('exit', function(e) {
    assert.equal(receivedError, true);
});
