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
        wwutil.debug(1, 'Received invalid message: ' + sys.inspect(msg));
        return;
    }

    switch(msg[0]) {
    case wwutil.MSGTYPE_NOOP:
        break;

    case wwutil.MSGTYPE_CLOSE:
        // Conform to the Web Workers API for termination
        workerCtx.closing = true;

        // Close down the event sources that we know about
        s.destroy();

        // Request that the worker perform any application-level shutdown
        if (workerCtx.onclose) {
            workerCtx.onclose();
        }

        break;

    case wwutil.MSGTYPE_USER:
        // XXX: I have no idea what the event object here should really look
        //      like. I do know that it needs a 'data' elements, though.
        if (workerCtx.onmessage) {
            workerCtx.onmessage({ data : msg[1] });
        }

        break;

    default:
        wwutil.debug(1, 'Received unexpected message: ' + sys.inspect(msg));
        break;
    }
});

// Register for uncaught events for delivery to workerCtx.onerror
//
// XXX: Schedule an event to the master if we didn't handle it ourselves as per
// http://www.whatwg.org/specs/web-workers/current-work/#runtime-script-errors
//
// XXX: I have no idea what the object delivered to 'onerror' should be.
//      Let's try an exception for now.
//
// XXX: If this is a shared worker do not bubble up to the master.
//
// XXX: If a dedicated worker receives an error message from one of its
//      children, it needs to bubble it up to the master.
var inErrorHandler = false;
process.addListener('uncaughtException', function(e) {
    if (!inErrorHandler && workerCtx.onerror) {
        inErrorHandler = true;
        workerCtx.onerror(e);
        inErrorHandler = false;

        return;
    }

    // Don't bother setting inErrorHandler here, as we're already delivering
    // the event to the master anyway
    //
    // XXX: Parse these values from e.stack.split('\n')
    // 
    //[ 'ReferenceError: ffl is not defined'
    //, '    at repl:1:6'
    //, '    at REPLServer.readline (repl:84:17)'
    //, '    at Stream.<anonymous> (repl:47:19)'
    //, '    at Stream.emit (events:25:26)'
    //, '    at IOWatcher.callback (net:378:14)'
    //, '    at node.js:204:9'
    //]
    //
    // XXX: Need unit tests, badly.
    //
    ms.send([wwutil.MSGTYPE_ERROR, {
        'message' : e.message,
        'filename' : 'unknown',
        'lineno' : -1,
    }]);
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
workerCtx.closing = false;
workerCtx.close = function() {
    process.exit(0);
};

scriptObj.runInNewContext(workerCtx);
