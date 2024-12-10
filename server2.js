var express = require('express');
var PeerServer = require('peer').PeerServer;
var ExpressPeerServer = require('peer').ExpressPeerServer;

var connections = [];

var app = express();
var server = app.listen(9000);
var q = ExpressPeerServer(server, {
  /* port: 9000, 
  path: '/noface',  */
  allow_discovery: true
});

app.use('/noface', q);

q.on('connection', function (id) {
    connections.push(id);
    console.log('user with ', id, 'connected');
});

q.on('disconnect', function (id) {
  connections.slice(connections.indexOf(id), 1);
  console.log('user with ', id, 'disconnected');
});

q.get("peers", function(){
  return JSON.stringify(connections);
});
