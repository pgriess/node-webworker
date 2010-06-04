`node-webworkers` is an experimental implementation of the [Web Workers
API](http://www.whatwg.org/specs/web-workers/current-work/) for
[node.js](http://nodejs.org).

### Example

#### Master source

    var sys = require('sys');
    var Worker = require('webworker').Worker;
    
    var w = new Worker('foo.js');
    
    w.onmessage = function(e) {
        sys.debug('Received mesage: ' + sys.inspect(e));
        w.terminate();
    };
    
    w.postMessage({ foo : 'bar' });

#### Worker source

    onmessage = function(e) {
        postMessage({ test : 'this is a test' });
    };
