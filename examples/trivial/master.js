var Worker = require("webworker").Worker;
var worker = new Worker(__dirname + "/worker.js");
worker.onmessage = function (message) {
    console.log(message.data);
    worker.terminate();
};
worker.postMessage("Hello, World!");

