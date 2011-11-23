

/*-----------------------------------------------
  Requirements:
-----------------------------------------------*/

// System
var sys    = require("sys")
  , http   = require("http")
  , events = require("events")
  , path   = require("path");

// Local
//require.paths.unshift(__dirname);

var Manager = require("./ws/manager")
  , Connection = require("./ws/connection");


/*-----------------------------------------------
  Mixin:
-----------------------------------------------*/
var mixin = function(target, source) {
  for(var i = 0, keys = Object.keys(source), l = keys.length; i < l; ++i) {
    var key = keys[i];
    target[key] = source[key];
  }
  return target;
};

/*-----------------------------------------------
  WebSocket Server Exports:
-----------------------------------------------*/
exports.Server = Server;
exports.createServer = function(options){
  return new Server(options || {});
};

/*-----------------------------------------------
  WebSocket Server Implementation:
-----------------------------------------------*/
function Server(options){
  this.options = mixin({
    debug: false,         // Boolean:       Show debug information.
    version: "auto",      // String:        Value must be either: draft75, draft76, auto
    origin: "*",          // String, Array: A match for a valid connection origin
    subprotocol: null,    // String, Array: A match for a valid connection subprotocol.
  }, options || {});

  var ws        = this;
  this.debug    = !!this.options.debug;
  this.server   = new http.Server();
  this.manager  = new Manager(this.debug);
  
  events.EventEmitter.call(this);
  
  this.server.addListener("upgrade", function(req, socket, upgradeHead){
    if( req.method == "GET" && ( "upgrade" in req.headers && "connection" in req.headers) && 
        req.headers.upgrade.toLowerCase() == "websocket" && req.headers.connection.toLowerCase() == "upgrade"
    ){
      // create a new connection, it'll handle everything else.
      new Connection(ws, req, socket, upgradeHead);
    } else {
      // Close the socket, it wasn't a valid connection.
      socket.end();
      socket.destroy();
    }
  });
  
  this.server.addListener("listening", function(req, res){
    ws.emit("listening");
  });
  
  this.server.addListener("request", function(req, res){
    ws.emit("request", req, res);
  });
  
  this.server.addListener("stream", function(stream){
    ws.emit("stream", stream);
  });
  
  this.server.addListener("close", function(errno){
    ws.emit("shutdown", errno);
  });
  
  this.server.addListener("clientError", function(e){
    ws.emit("clientError", e);
  });
};

sys.inherits(Server, events.EventEmitter);

/*-----------------------------------------------
  Public API
-----------------------------------------------*/
Server.prototype.listen = function(){
  this.server.listen.apply(this.server, arguments);
};

Server.prototype.close = function(){
  this.server.close();
};

Server.prototype.send = function(id, data){
  this.manager.find(id, function(client){
    if(client._state === 4){
      client.write(data);
    }
  });
};

Server.prototype.broadcast = function(data){
  this.manager.forEach(function(client){
    if(client._state === 4){
      client.write(data);
    }
  });
};
