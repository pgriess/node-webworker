// Launcher script for WebWorkers.
//
// Sets up context and runs a worker script. This is not intended to be
// invoked directly. Rather, it is invoked automatically when constructing a
// new Worker() object.
//
//      usage: node worker.js <sock> <script>
//
//      The <sock> parameter is the filesystem path to a UNIX domain socket
//      that is listening for connections. The <script> parameter is the
//      path to the JavaScript source to be executed as the body of the
//      worker.

var msgpack = require('msgpack');
var net = require('net');
var sys = require('sys');

if (process.argv.length < 4) {
    throw new Error('usage: node worker.js <sock> <script>');
}

var sockPath = process.argv[2];
var scriptPath = process.argv[3];

var s = net.createConnection(sockPath);
var ms = new msgpack.Stream(s);

s.addListener('connect', function() {
    sys.debug('connected to server');

    ms.send([1, process.pid]);
    ms.send({'hello' : 'world'});
});

ms.addListener('msg', function(m) {
    sys.debug('received message from parent!');
});
