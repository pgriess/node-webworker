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

var assert = require('assert');
var fs = require('fs');
var net = require('net');
var path = require('path');
var script = process.binding('evals');
var sys = require('sys');
var wwutil = require('webworker-utils');

var writeError = process.binding('stdio').writeError;

if (process.argv.length < 4) {
    throw new Error('usage: node worker.js <sock> <script>');
}

var sockPath = process.argv[2];
var scriptLoc = new wwutil.WorkerLocation(process.argv[3]);

var scriptObj = undefined;

switch (scriptLoc.protocol) {
case 'file':
    scriptObj = new script.Script(
        fs.readFileSync(scriptLoc.pathname),
        scriptLoc.href
    );
    break;

default:
    writeError('Cannot load script from unknown protocol \'' + 
        scriptLoc.protocol);
    process.exit(1);
}

var s = net.createConnection(sockPath);
var ms = new wwutil.MsgStream(s);

// Perform handshaking when we connect
s.addListener('connect', function() {
    ms.send([wwutil.MSGTYPE_HANDSHAKE, process.pid]);
});

// When we receive a message from the master, react and possibly dispatch it
// to the worker context
ms.addListener('msg', function(msg, fd) {
    if (!wwutil.isValidMessage(msg)) {
        sys.debug('Received invalid message: ' + sys.inspect(msg));
        return;
    }

    switch(msg[0]) {
    case wwutil.MSGTYPE_NOOP:
        break;

    case wwutil.MSGTYPE_USER:
        if (workerCtx.onmessage) {
            workerCtx.onmessage(msg[1]);
        }

        break;

    default:
        sys.debug('Received unexpected message: ' + msg);
        break;
    }
});

// Set up the context for the worker instance
var workerCtx = {};

// Context elements required for node.js
workerCtx.global = workerCtx;
workerCtx.process = process;
workerCtx.require = require;
workerCtx.__filename = scriptLoc.pathname;
workerCtx.__dirname = path.dirname(scriptLoc.pathname);

// Context elements required by the WebWorkers API spec
workerCtx.postMessage = function(msg) {
    ms.send([wwutil.MSGTYPE_USER, msg]);
};
workerCtx.self = workerCtx;
workerCtx.location = scriptLoc;
workerCtx.close = function() {
    process.exit(0);
};

scriptObj.runInNewContext(workerCtx);
