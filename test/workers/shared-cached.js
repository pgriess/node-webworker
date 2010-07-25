// Worker for testing cached shared workers.

var numConnections = 0;
var numMessages = 0;
var sum = 0;

onconnect = function(e) {
    var port = e.ports[0];
    numConnections++;

    port.onmessage = function(e) {
        numMessages++;
        sum += e.data;

        port.postMessage(sum);
    };
};
