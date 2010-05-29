var sys = require('sys');
var webworker = require('webworker');

var w = new webworker.Worker('qqq');
w.onmessage = function(msg) {
    sys.debug('Received message: ' + sys.inspect(msg));
};
