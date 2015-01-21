/// <reference path="./typings/tsd.d.ts"/>

module ChromeApp {
	var path = require('path'),
		events = require('events'),
		_ = require("lodash"),
		bcrypt = require("bcrypt-nodejs"),
		EventEmitter = events.EventEmitter,
		Helper = require('../src/helper.js'),
		Client = require('../src/client.js'),
		ClientManager = require('../src/clientManager.js'),
		manager = new ClientManager(),
		client;

	Helper.getConfig = function() {
		return {};
	}

	Client.prototype.save = function() {
		return true;
	}	

	export var emitter = new EventEmitter();

	emitter.join = function (i) {
		if(!this.joined) this.joined = [];
		this.joined.push(i);
	}

	emitter.in = function(id) {
		return this;
	}

	var config:any = {};
	var sockets = {};

	manager.sockets = sockets;

	/*
	emitter.on("connect", function(socket) {
		if (config.public) {
			auth.call(socket);
		} else {
			init(socket);
		}
	});
	*/


	client = new Client(emitter);

	init(emitter, client);

	function init(socket, client?, token?) {
		if (!client) {
			socket.emit("auth");
			socket.on("auth", auth);
		} else {
			socket.on(
				"input",
				function(data) {
					client.input(data);
				}
			);
			socket.on(
				"more",
				function(data) {
					client.more(data);
				}
			);
			socket.on(
				"conn",
				function(data) {
					client.connect(data);
				}
			);
			socket.on(
				"open",
				function(data) {
					client.open(data);
				}
			);
			socket.on(
				"sort",
				function(data) {
					client.sort(data);
				}
			);
			socket.join(client.id);
			socket.emit("init", {
				active: client.activeChannel,
				networks: client.networks,
				token: token || ""
			});
		}
	}

	function auth(data) {
		var socket = this;
		if (config.public) {
			var client = new Client(sockets);
			manager.clients.push(client);
			socket.on("disconnect", function() {
				manager.clients = _.without(manager.clients, client);
				client.quit();
			});
			init(socket, client);
		} else {
			var success = false;
			_.each(manager.clients, function(client) {
				if (data.token) {
					if (data.token == client.token) {
						success = true;
					}
				} else if (client.config.user == data.user) {
					if (bcrypt.compareSync(data.password || "", client.config.password)) {
						success = true;
					}
				}
				if (success) {
					var token;
					if (data.remember || data.token) {
						token = client.token;
					}
					init(socket, client, token);
					return false;
				}
			});
			if (!success) {
				socket.emit("auth");
			}
		}
	}	
}

if(window) {
	console.log('setting chrome app to window');
	(<any>window).ChromeApp = ChromeApp;
}