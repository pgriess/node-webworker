var assert = require('assert');
var sys = require('sys');

onmessage = function(e) {
    assert.ok('data' in e);
    assert.ok('foo' in e.data);
    assert.equal(e.data.foo, 'bar');

    var msg = {};
    for (k in e.data) {
        msg[e.data[k]] = k;
    }

    postMessage(msg);
};
