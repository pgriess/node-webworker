var path = require('path');
var sys = require('sys');
var webworker = require('webworker');

var w = new webworker.Worker(
    path.join(__dirname, 'test-basic-worker.js')
);
w.onmessage = function(msg) {
    sys.debug('Received message: ' + sys.inspect(msg) + ' from worker');
};

w.postMessage('Watson!');
