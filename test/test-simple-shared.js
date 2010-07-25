// Verify that we can create a shared worker.

var assert = require('assert');
var path = require('path');
var SharedWorker = require('../lib').SharedWorker;
var sys = require('sys');

var receivedMsg = false;
var receivedExit = false;

var sw = new SharedWorker(
    path.join(__dirname, 'workers', 'simple-shared.js')
);

sw.port.onmessage = function(e) {
    assert.ok('data' in e);
    assert.equal(e.data.bar, 'foo');
    assert.equal(e.data.bunkle, 'baz');

    receivedMsg = true;

    sw.terminate();
};

sw.port.onexit = function(c, s) {
    assert.equal(c, 0);
    assert.equal(s, null);

    receivedExit = true;
};

sw.port.postMessage({'foo' : 'bar', 'baz' : 'bunkle'});

process.addListener('exit', function() {
    assert.equal(receivedMsg, true);
    assert.equal(receivedExit, true);
});
