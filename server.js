const fs = require("fs");
var PeerServer = require('peer').PeerServer;

var server = new PeerServer({
  port: 9000, 
  path: '/noface', 
  allow_discovery: true,
  ssl: {
		key: fs.readFileSync("/etc/letsencrypt/live/flypix.app/privkey.pem"),
		cert: fs.readFileSync("/etc/letsencrypt/live/flypix.app/fullchain.pem"),
	},
});