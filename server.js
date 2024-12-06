var PeerServer = require('peer').PeerServer;
var server = new PeerServer({port: 9000, path: '/myapp'});
var connected = [];

server.on('connection', function (id) {
  var idx = connected.indexOf(id);
  if (idx === -1) {connected.push(id);}
});

server.on('disconnect', function (id) {
  var idx = connected.indexOf(id);
  if (idx !== -1) {connected.splice(idx, 1);}
});


var express = require('express');
var app = express();
var server = require('http').createServer(app);

server.on('connection', (req, res) => { return res.json(connected); });