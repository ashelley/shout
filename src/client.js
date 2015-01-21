var _ = require("lodash");
var Chan = require("./models/chan");
var crypto = require("crypto");
var fs = require("fs");
var identd = require("./identd");
var log = require("./log");
var net = require("net");
var Msg = require("./models/msg");
var Network = require("./models/network");
var slate = require("slate-irc");
var tls = require("tls");
var Helper = require("./helper");

module.exports = Client;

var id = 0;
var events = [
	"ctcp",
	"error",
	"join",
	"kick",
	"mode",
	"motd",
	"message",
	"link",
	"names",
	"nick",
	"notice",
	"part",
	"quit",
	"topic",
	"welcome",
	"whois"
];
var inputs = [
	"action",
	"connect",
	"invite",
	"join",
	"kick",
	"mode",
	"msg",
	"nick",
	"notice",
	"part",
	"quit",
	"raw",
	"services",
	"topic",
	"whois"
];

var plugins = {
	ctcp: require('./plugins/irc-events/ctcp'),
	error: require('./plugins/irc-events/error'),
	join: require('./plugins/irc-events/join'),
	kick: require('./plugins/irc-events/kick'),
	mode: require('./plugins/irc-events/mode'),
	motd: require('./plugins/irc-events/motd'),
	message: require('./plugins/irc-events/message'),
	link: require('./plugins/irc-events/link'),
	names: require('./plugins/irc-events/names'),
	nick: require('./plugins/irc-events/nick'),
	notice: require('./plugins/irc-events/notice'),
	part: require('./plugins/irc-events/part'),
	quit: require('./plugins/irc-events/quit'),
	topic: require('./plugins/irc-events/topic'),
	welcome: require('./plugins/irc-events/welcome'),
	whois: require('./plugins/irc-events/whois')
}

var inputsPlugins = {
	"action": require('./plugins/inputs/action'),
	"connect": require('./plugins/inputs/connect'),
	"invite": require('./plugins/inputs/invite'),
	"join": require('./plugins/inputs/join'),
	"kick": require('./plugins/inputs/kick'),
	"mode": require('./plugins/inputs/mode'),
	"msg": require('./plugins/inputs/msg'),
	"nick": require('./plugins/inputs/nick'),
	"notice": require('./plugins/inputs/notice'),
	"part": require('./plugins/inputs/part'),
	"quit": require('./plugins/inputs/quit'),
	"raw": require('./plugins/inputs/raw'),
	"services": require('./plugins/inputs/services'),
	"topic": require('./plugins/inputs/topic'),
	"whois": require('./plugins/inputs/whois')
}

function Client(sockets, name, config) {
	_.merge(this, {
		activeChannel: -1,
		config: config,
		id: id++,
		name: name,
		networks: [],
		sockets: sockets
	});
	var client = this;
	crypto.randomBytes(48, function(err, buf) {
		client.token = buf.toString("hex");
	});
	if (config) {
		var delay = 0;
		(config.networks || []).forEach(function(n) {
			setTimeout(function() {
				client.connect(n);
			}, delay);
			delay += 1000;
		});
	}
}

Client.prototype.emit = function(event, data) {
	if (this.sockets !== null) {
		this.sockets.in(this.id).emit(event, data);
	}
	var config = this.config || {};
	if (config.log === true) {
		if (event == "msg") {
			var target = this.find(data.chan);
			if (target) {
				var chan = target.chan.name;
				if (target.chan.type == Chan.Type.LOBBY) {
					chan = target.network.host;
				}
				log.write(
					this.name,
					target.network.host,
					chan,
					data.msg
				);
			}
		}
	}
};

Client.prototype.find = function(id) {
	var network = null;
	var chan = null;
	for (var i in this.networks) {
		var n = this.networks[i];
		chan = _.find(n.channels, {id: id});
		if (chan) {
			network = n;
			break;
		}
	}
	if (network && chan) {
		return {
			network: network,
			chan: chan
		};
	} else {
		return false;
	}
};

Client.prototype.connect = function(args) {
	var config = Helper.getConfig();
	var client = this;
	var server = {
		name: args.name || "",
		host: args.host || "irc.freenode.org",
		port: args.port || (args.tls ? 6697 : 6667),
		rejectUnauthorized: false
	};

	if (config.bind) {
		server.localAddress = config.bind;
		if(args.tls) {
			var socket = net.connect(server);
			server.socket = socket;
		}
	}

	console.log("connecting to server", server);

	var stream = args.tls ? tls.connect(server) : net.connect(server);

	stream.on("error", function(e) {
		console.log("Client#connect():\n" + e);
		stream.end();
		var msg = new Msg({
			type: Msg.Type.ERROR,
			text: "Connection error."
		});
		client.emit("msg", {
			msg: msg
		});
	});

	var nick = args.nick || "shout-user";
	var username = args.username || nick.replace(/[^a-zA-Z0-9]/g, '');
	var realname = args.realname || "Shout User";

	var irc = slate(stream);
	identd.hook(stream, username);

	if (args.password) {
		irc.pass(args.password);
	}

	irc.me = nick;
	irc.nick(nick);
	irc.user(username, realname);

	var network = new Network({
		name: server.name,
		host: server.host,
		port: server.port,
		tls: !!args.tls,
		password: args.password,
		username: username,
		realname: realname,
		commands: args.commands
	});

	network.irc = irc;

	client.networks.push(network);
	client.emit("network", {
		network: network
	});

	events.forEach(function(plugin) {
		/*
		var path = "./plugins/irc-events/" + plugin;
		require(path).apply(client, [
			irc,
			network
		]);
		*/
		plugins[plugin].apply(client, [
			irc,
			network
		]);		
	});

	irc.once("welcome", function() {
		var delay = 1000;
		var commands = args.commands;
		if (Array.isArray(commands)) {
			commands.forEach(function(cmd) {
				setTimeout(function() {
					client.input({
						target: network.channels[0].id,
						text: cmd
					});
				}, delay);
				delay += 1000;
			});
		}
		setTimeout(function() {
			irc.write("PING " + network.host);
		}, delay);
	});

	irc.once("pong", function() {
		var join = (args.join || "");
		if (join) {
			join = join.replace(/\,/g, " ").split(/\s+/g);
			irc.join(join);
		}
	});
};

Client.prototype.input = function(data) {
	var client = this;
	var text = data.text.trim();
	var target = client.find(data.target);
	if (text.charAt(0) !== "/") {
		text = "/say " + text;
	}
	var args = text.split(" ");
	var cmd = args.shift().replace("/", "").toLowerCase();

	_.each(inputs, function(plugin) {
		try {
			//var path = "./plugins/inputs/" + plugin;
			//var fn = require(path);
			fn = inputsPlugins[plugin];
			fn.apply(client, [
				target.network,
				target.chan,
				cmd,
				args
			]);
		} catch (e) {
			//console.log(path + ": " + e);
			console.log(plugin + ": " + e);
		}
	});
};

Client.prototype.more = function(data) {
	var client = this;
	var target = client.find(data.target);
	if (!target) {
		return;
	}
	var chan = target.chan;
	var count = chan.messages.length - (data.count || 0);
	var messages = chan.messages.slice(Math.max(0, count - 100), count);
	client.emit("more", {
		chan: chan.id,
		messages: messages
	});
};

Client.prototype.open = function(data) {
	var target = this.find(data);
	if (target) {
		target.chan.unread = 0;
		this.activeChannel = target.chan.id;
	}
};

Client.prototype.sort = function(data) {
	var self = this;

	var type = data.type;
	var order = data.order || [];

	switch (type) {
	case "networks":
		var sorted = [];
		_.each(order, function(i) {
			var find = _.find(self.networks, {id: i});
			if (find) {
				sorted.push(find);
			}
		});
		self.networks = sorted;
		break;

	case "channels":
		var target = data.target;
		var network = _.find(self.networks, {id: target});
		if (!network) {
			return;
		}
		var sorted = [];
		_.each(order, function(i) {
			var find = _.find(network.channels, {id: i});
			if (find) {
				sorted.push(find);
			}
		});
		network.channels = sorted;
		break;
	}
};

Client.prototype.quit = function() {
	var sockets = this.sockets.sockets;
	var room = sockets.adapter.rooms[this.id] || [];
	for (var user in room) {
		var socket = sockets.adapter.nsp.connected[user];
		if (socket) {
			socket.disconnect();
		}
	}
	this.networks.forEach(function(network) {
		var irc = network.irc;
		if (network.connected) {
			irc.quit();
		} else {
			irc.stream.end();
		}
	});
};

var timer;
Client.prototype.save = function(force) {
	var client = this;
	var config = Helper.getConfig();

	if(config.public) {
		return;
	}

	if (!force) {
		clearTimeout(timer);
		timer = setTimeout(function() {
			client.save(true);
		}, 1000);
		return;
	}

	var name = this.name;
	var path = Helper.HOME + "/users/" + name + ".json";

	var networks = _.map(
		this.networks,
		function(n) {
			return n.export();
		}
	);

	var json = {};
	fs.readFile(path, "utf-8", function(err, data) {
		if (err) {
			console.log(err);
			return;
		}

		try {
			json = JSON.parse(data);
			json.networks = networks;
		} catch(e) {
			console.log(e);
			return;
		}

		fs.writeFile(
			path,
			JSON.stringify(json, null, "  "),
			{mode: "0777"},
			function(err) {
				if (err) {
					console.log(err);
				}
			}
		);
	});
};
