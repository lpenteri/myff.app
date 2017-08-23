#!/usr/bin/node

// news app 
var myffapp = require('./myffapp.js');
var settings = require('./helpers/user-settings').file('./conf/userconf.json');

var http = require('http');

var finalhandler = require('finalhandler');
var serveStatic = require('serve-static');

var serve = serveStatic("./");

var server = http.createServer(function(req, res) {
  var done = finalhandler(req, res);
  serve(req, res, done);
});

server.listen(3035);

// new app
var app = new myffapp();
app.run();

// TODO: setup cleanup handler (unsubscribe and delete topic)
/// \brief process handlers (CTRL+c, Kill, Exception) cleanup
//process.stdin.resume();
//process.on('exit', exitHandler.bind(null,{cleanup:true}));
//process.on('SIGINT', exitHandler.bind(null, {exit:true}));
//process.on('uncaughtException', exitHandler.bind(null, {exit:true}));
