require('dotenv').config();
const util = require('util');
util.inspect.defaultOptions = {compact:false,breakLength:Infinity};

var isDebug = ( process.argv[2] === 'debug' );
var ready = {
	patreons: false,
	voice: false,
	allSites: true
}

global.shardId = null;
process.on( 'message', message => {
	if ( !message.shard ) return;
	shardId = message.shard.id;
} );

const Discord = require('discord.js');
const got = require('got').extend( {
	throwHttpErrors: false,
	timeout: 5000,
	headers: {
		'User-Agent': 'Wiki-Bot/' + ( isDebug ? 'testing' : process.env.npm_package_version ) + ' (Discord; ' + process.env.npm_package_name + ')'
	}
} );
const htmlparser = require('htmlparser2');
const cheerio = require('cheerio');

const sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database( './wikibot.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, dberror => {
	if ( dberror ) {
		console.log( '- ' + shardId + ': Error while connecting to the database: ' + dberror );
		return dberror;
	}
	console.log( '- ' + shardId + ': Connected to the database.' );
} );

var client = new Discord.Client( {
	messageCacheLifetime: 300,
	messageSweepInterval: 300,
	allowedMentions: {
		parse: []
	},
	presence: {
		status: 'online',
		activity: {
			type: 'STREAMING',
			name: process.env.prefix + ' help',
			url: 'https://www.twitch.tv/wikibot'
		}
	},
	ws: {
		large_threshold: 1000,
		intents: [
			'GUILDS',
			'GUILD_MESSAGES',
			'GUILD_MESSAGE_REACTIONS',
			'GUILD_VOICE_STATES',
			'GUILD_INTEGRATIONS',
			'DIRECT_MESSAGES',
			'DIRECT_MESSAGE_REACTIONS'
		]
	}
} );

var i18n = require('./i18n/allLangs.json');
Object.keys(i18n.allLangs[1]).forEach( lang => i18n[lang] = require('./i18n/' + lang + '.json') );
const minecraft = require('./minecraft.json');

global.pause = {};
var stop = false;
const defaultPermissions = 403033152;
const timeoptions = {
	year: 'numeric',
	month: 'short',
	day: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	timeZone: 'UTC',
	timeZoneName: 'short'
}

const defaultSettings = {
	lang: "en",
	wiki: "https://community.fandom.com/"
}

global.patreons = {};
function getSettings(trysettings = 1) {
	db.each( 'SELECT guild, prefix FROM discord WHERE patreon IS NOT NULL', [], (dberror, row) => {
		if ( dberror ) {
			console.log( '- ' + shardId + ': ' + trysettings + '. Error while getting the patreon: ' + dberror );
				if ( trysettings < 10 ) {
					trysettings++;
					getSettings(trysettings);
				}
			return dberror;
		}
		patreons[row.guild] = row.prefix;
	}, (dberror) => {
		if ( dberror ) {
			console.log( '- ' + trysettings + '. Error while getting the patreons: ' + dberror );
			if ( dberror.message === 'SQLITE_ERROR: no such table: discord' ) db.serialize( () => {
				db.run( 'CREATE TABLE IF NOT EXISTS patreons(patreon TEXT PRIMARY KEY UNIQUE NOT NULL, count INTEGER NOT NULL)', [], function (error) {
					if ( error ) {
						console.log( '- ' + shardId + ': Error while creating the patreons table: ' + error );
						return error;
					}
					console.log( '- Created the patreons table.' );
					db.run( 'CREATE INDEX idx_patreons_patreon ON patreons(patreon)', [], function (idxerror) {
						if ( idxerror ) {
							console.log( '- ' + shardId + ': Error while creating the patreons index: ' + idxerror );
							return error;
						}
						console.log( '- ' + shardId + ': Created the patreons index.' );
					} );
				} );
				db.run( 'CREATE TABLE IF NOT EXISTS discord(guild TEXT NOT NULL, channel TEXT, lang TEXT NOT NULL DEFAULT [' + defaultSettings.lang + '], wiki TEXT NOT NULL DEFAULT [' + defaultSettings.wiki + '], prefix TEXT NOT NULL DEFAULT [' + process.env.prefix + '], patreon TEXT, voice INTEGER, inline INTEGER, UNIQUE(guild, channel), FOREIGN KEY(patreon) REFERENCES patreons(patreon) ON DELETE SET NULL)', [], function (error) {
					if ( error ) {
						console.log( '- ' + shardId + ': Error while creating the discord table: ' + error );
						return error;
					}
					console.log( '- Created the discord table.' );
					db.run( 'CREATE TRIGGER unique_discord_guild BEFORE INSERT ON discord WHEN NEW.channel IS NULL BEGIN SELECT CASE WHEN (SELECT 1 FROM discord WHERE guild = NEW.guild AND channel IS NULL) IS NOT NULL THEN RAISE(ABORT, "UNIQUE constraint failed: discord.guild, discord.channel") END; END;', [], function (idxerror) {
						if ( idxerror ) {
							console.log( '- ' + shardId + ': Error while creating the discord guild trigger: ' + idxerror );
							return error;
						}
						console.log( '- ' + shardId + ': Created the discord guild trigger.' );
					} );
					db.run( 'CREATE INDEX idx_discord_patreon ON discord(patreon) WHERE patreon IS NOT NULL', [], function (idxerror) {
						if ( idxerror ) {
							console.log( '- ' + shardId + ': Error while creating the discord patreon index: ' + idxerror );
							return error;
						}
						console.log( '- ' + shardId + ': Created the discord patreon index.' );
					} );
					db.run( 'CREATE INDEX idx_discord_voice ON discord(voice) WHERE voice IS NOT NULL', [], function (idxerror) {
						if ( idxerror ) {
							console.log( '- ' + shardId + ': Error while creating the discord voice index: ' + idxerror );
							return error;
						}
						console.log( '- ' + shardId + ': Created the discord voice index.' );
					} );
					db.run( 'CREATE INDEX idx_discord_channel ON discord(guild, channel DESC)', [], function (idxerror) {
						if ( idxerror ) {
							console.log( '- ' + shardId + ': Error while creating the discord channel index: ' + idxerror );
							return error;
						}
						console.log( '- ' + shardId + ': Created the discord channel index.' );
					} );
					if ( trysettings < 10 ) {
						trysettings++;
						getSettings(trysettings);
					}
				} );
				db.run( 'CREATE TABLE IF NOT EXISTS verification(guild TEXT NOT NULL, configid INTEGER NOT NULL, channel TEXT NOT NULL, role TEXT NOT NULL, editcount INTEGER NOT NULL DEFAULT [0], usergroup TEXT NOT NULL DEFAULT [user], accountage INTEGER NOT NULL DEFAULT [0], rename INTEGER NOT NULL DEFAULT [0], UNIQUE(guild, configid))', [], function (error) {
					if ( error ) {
						console.log( '- ' + shardId + ': Error while creating the verification table: ' + error );
						return error;
					}
					console.log( '- ' + shardId + ': Created the verification table.' );
					db.run( 'CREATE INDEX idx_verification_config ON verification(guild, configid ASC, channel)', [], function (idxerror) {
						if ( idxerror ) {
							console.log( '- ' + shardId + ': Error while creating the verification index: ' + idxerror );
							return error;
						}
						console.log( '- ' + shardId + ': Created the verification index.' );
					} );
				} );
			} );
			else {
				if ( trysettings < 10 ) {
					trysettings++;
					getSettings(trysettings);
				}
			}
			return dberror;
		}
		console.log( '- ' + shardId + ': Patreons successfully loaded.' );
		ready.patreons = true;
		getVoice();
	} );
}

global.voice = {};
function getVoice(trysettings = 1) {
	db.each( 'SELECT guild, lang FROM discord WHERE voice IS NOT NULL', [], (dberror, row) => {
		if ( dberror ) {
			console.log( '- ' + shardId + ': ' + trysettings + '. Error while getting the voice channel: ' + dberror );
			if ( trysettings < 10 ) {
				trysettings++;
				getVoice(trysettings);
			}
			return dberror;
		}
		if ( client.guilds.cache.has(row.guild) ) voice[row.guild] = row.lang;
	}, (dberror) => {
		if ( dberror ) {
			console.log( '- ' + shardId + ': ' + trysettings + '. Error while getting the voice channels: ' + dberror );
			if ( trysettings < 10 ) {
				trysettings++;
				getVoice(trysettings);
			}
			return dberror;
		}
		console.log( '- ' + shardId + ': Voice channels successfully loaded.' );
		ready.voice = true;
	} );
}

var allSites = [];
function getAllSites() {
	ready.allSites = true;
	got.get( 'https://help.gamepedia.com/api.php?action=allsites&formatversion=2&do=getSiteStats&filter=wikis|md5_key,wiki_domain,wiki_display_name,wiki_image,wiki_description,wiki_managers,official_wiki,wiki_crossover,created&format=json', {
		responseType: 'json'
	} ).then( response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body || body.status !== 'okay' || !body.data || !body.data.wikis ) {
			console.log( '- ' + shardId + ': ' + response.statusCode + ': Error while gettings all sites: ' + ( body && body.error && body.error.info ) );
			ready.allSites = false;
		}
		else {
			console.log( '- ' + shardId + ': Sites successfully loaded.' );
			allSites = JSON.parse(JSON.stringify(body.data.wikis.filter( site => /^[a-z\d-]{1,50}\.gamepedia\.com$/.test(site.wiki_domain) )));
			allSites.filter( site => site.wiki_crossover ).forEach( site => site.wiki_crossover = site.wiki_crossover.replace( /^(?:https?:)?\/\/(([a-z\d-]{1,50})\.(?:fandom\.com|wikia\.org)(?:(?!\/wiki\/)\/([a-z-]{1,8}))?).*/, '$1' ) );
		}
	}, error => {
			console.log( '- ' + shardId + ': Error while gettings all sites: ' + error );
	} );
}

client.on( 'ready', () => {
	client.ready = true;
	console.log( '\n- ' + shardId + ': Successfully logged in as ' + client.user.username + '!\n' );
	getSettings();
	getAllSites();
	
	if ( !isDebug ) client.setInterval( () => {
		console.log( '- ' + shardId + ': Current server count: ' + client.guilds.cache.size );
		if ( process.env.dbltoken ) got.post( 'https://top.gg/api/bots/' + client.user.id + '/stats', {
			headers: {
				Authorization: process.env.dbltoken
			},
			json: {
				server_count: client.guilds.cache.size,
				shard_count: client.shard.count,
				shard_id: shardId
			},
			responseType: 'json'
		} ).catch( error => {
			console.log( '- ' + shardId + ': Error while posting statistics to https://top.gg/bot/' + client.user.id + ': ' + error );
		} );
		if ( process.env.dbggtoken ) got.post( 'https://discord.bots.gg/api/v1/bots/' + client.user.id + '/stats', {
			headers: {
				Authorization: process.env.dbggtoken
			},
			json: {
				guildCount: client.guilds.cache.size,
				shardCount: client.shard.count,
				shardId: shardId
			},
			responseType: 'json'
		} ).catch( error => {
			console.log( '- ' + shardId + ': Error while posting statistics to https://discord.bots.gg/bots/' + client.user.id + ': ' + error );
		} );
	}, 10800000 ).unref();
} );
client.on( 'shardDisconnect', () => client.ready = false );
	
	
var cmdmap = {
	help: cmd_help,
	test: cmd_test,
	pause: cmd_pause,
	invite: cmd_invite,
	voice: cmd_voice,
	verify: cmd_verify,
	verification: cmd_verification,
	settings: cmd_settings,
	info: cmd_info,
	patreon: cmd_patreon
}

var ownercmdmap = {
	stop: cmd_stop,
	pause: cmd_pause,
	say: cmd_say,
	eval: cmd_eval,
	get: cmd_get,
	patreon: cmd_patreon
}

var pausecmdmap = {
	help: cmd_help,
	test: cmd_test,
	pause: cmd_pause,
	voice: cmd_voice,
	verification: cmd_verification,
	settings: cmd_settings,
	patreon: cmd_patreon
}

var minecraftcmdmap = {
	command: minecraft_command2,
	bug: minecraft_bug
}

function cmd_helpsetup(lang, msg) {
	msg.defaultSettings = false;
	msg.replyMsg( lang.settings.missing.replaceSave( '%1$s', '`' + process.env.prefix + ' settings lang`' ).replaceSave( '%2$s', '`' + process.env.prefix + ' settings wiki`' ) );
}

function cmd_settings(lang, msg, args, line, wiki) {
	if ( !msg.isAdmin() ) return msg.reactEmoji('❌');
	
	db.all( 'SELECT channel, lang, wiki, prefix, inline FROM discord WHERE guild = ? ORDER BY channel DESC', [msg.guild.id], (error, rows) => {
		if ( error ) {
			console.log( '- Error while getting the settings: ' + error );
			msg.reactEmoji('error', true);
			return error;
		}
		var guild = rows.find( row => !row.channel );
		if ( !guild ) guild = Object.assign({prefix: process.env.prefix}, defaultSettings);
		var prefix = guild.prefix;
		var text = lang.settings.missing.replaceSave( '%1$s', '`' + prefix + ' settings lang`' ).replaceSave( '%2$s', '`' + prefix + ' settings wiki`' );
		if ( rows.length ) {
			text = lang.settings.current + '\n' + lang.settings.currentlang + ' `' + i18n.allLangs[2][guild.lang] + '` - `' + prefix + ' settings lang`';
			if ( msg.guild.id in patreons ) text += '\n' + lang.settings.currentprefix + ' `' + prefix + '` - `' + prefix + ' settings prefix`';
			text += '\n' + lang.settings.currentinline + ' ' + ( guild.inline ? '~~' : '' ) + '`[[' + lang.search.page + ']]`' + ( guild.inline ? '~~' : '' ) + ' - `' + prefix + ' settings inline`';
			text += '\n' + lang.settings.currentwiki + ' ' + guild.wiki + ' - `' + prefix + ' settings wiki`';
			text += '\n' + lang.settings.currentchannel + ' `' + prefix + ' settings channel`\n';
			if ( rows.length === 1 ) text += lang.settings.nochannels;
			else text += rows.filter( row => row !== guild ).map( row => '<#' + row.channel + '>: ' + ( msg.guild.id in patreons ? '`' + i18n.allLangs[2][row.lang] + '` - ' : '' ) + '<' + row.wiki + '>' + ( msg.guild.id in patreons ? ' - ' + ( row.inline ? '~~' : '' ) + '`[[' + lang.search.page + ']]`' + ( row.inline ? '~~' : '' ) : '' ) ).join('\n');
		}
		
		if ( !args.length ) {
			return msg.replyMsg( text, {split:true}, true );
		}
		
		var prelang = '';
		args[0] = args[0].toLowerCase();
		if ( args[0] === 'channel' ) {
			prelang = 'channel ';
			if ( !rows.length ) return msg.replyMsg( text, {split:true}, true );
			
			var channel = rows.find( row => row.channel === msg.channel.id );
			if ( !channel ) channel = Object.assign({channel:msg.channel.id}, guild);
			text = lang.settings[prelang + 'current'];
			if ( msg.guild.id in patreons ) {
				text += '\n' + lang.settings.currentlang + ' `' + i18n.allLangs[2][channel.lang] + '` - `' + prefix + ' settings channel lang`';
				text += '\n' + lang.settings.currentinline + ' ' + ( channel.inline ? '~~' : '' ) + '`[[' + lang.search.page + ']]`' + ( channel.inline ? '~~' : '' ) + ' - `' + prefix + ' settings channel inline`';
			}
			text += '\n' + lang.settings.currentwiki + ' ' + channel.wiki + ' - `' + prefix + ' settings channel wiki`';
			
			if ( !args[1] ) return msg.replyMsg( text, {}, true );
			
			args[0] = args[1].toLowerCase();
			args[1] = args.slice(2).join(' ').toLowerCase().trim().replace( /^<(.*)>$/, '$1' );
		}
		else args[1] = args.slice(1).join(' ').toLowerCase().trim().replace( /^<(.*)>$/, '$1' );
		
		if ( args[0] === 'wiki' ) {
			prelang += 'wiki';
			var wikihelp = '\n' + lang.settings.wikihelp.replaceSave( '%s', prefix + ' settings ' + prelang );
			if ( !args[1] ) {
				if ( !rows.length ) return msg.replyMsg( lang.settings.wikimissing + wikihelp, {}, true );
				else return msg.replyMsg( lang.settings[prelang] + ' ' + ( channel || guild ).wiki + wikihelp, {}, true );
			}
			var regex = args[1].match( /^(?:https:\/\/)?([a-z\d-]{1,50}\.(?:gamepedia\.com|(?:fandom\.com|wikia\.org)(?:(?!\/wiki\/)\/[a-z-]{1,8})?))(?:\/|$)/ );
			if ( !regex ) {
				var value = args[1].split(' ');
				if ( value.length === 2 && value[1] === '--force' ) return msg.reactEmoji('⏳', true).then( reaction => {
					got.get( value[0] + 'api.php?action=query&format=json', {
						responseType: 'json'
					} ).then( response => {
						var body = response.body;
						if ( response.statusCode !== 200 || !body || body.batchcomplete === undefined || !( body instanceof Object ) ) {
							console.log( '- ' + response.statusCode + ': Error while testing the wiki: ' + ( body && body.error && body.error.info ) );
							if ( reaction ) reaction.removeEmoji();
							msg.reactEmoji('nowiki', true);
							return msg.replyMsg( lang.settings.wikiinvalid + wikihelp, {}, true );
						}
						var sql = 'UPDATE discord SET wiki = ? WHERE guild = ? AND wiki = ?';
						var sqlargs = [value[0], msg.guild.id, guild.wiki];
						if ( !rows.length ) {
							sql = 'INSERT INTO discord(wiki, guild) VALUES(?, ?)';
							sqlargs.pop();
						}
						if ( channel ) {
							sql = 'UPDATE discord SET wiki = ? WHERE guild = ? AND channel = ?';
							sqlargs[2] = msg.channel.id;
							if ( !rows.includes( channel ) ) {
								if ( channel.wiki === value[0] ) {
									if ( reaction ) reaction.removeEmoji();
									return msg.replyMsg( lang.settings[prelang + 'changed'] + ' ' + channel.wiki + wikihelp, {}, true );
								}
								sql = 'INSERT INTO discord(wiki, guild, channel, lang, prefix) VALUES(?, ?, ?, ?, ?)';
								sqlargs.push(guild.lang, guild.prefix);
							}
						}
						return db.run( sql, sqlargs, function (dberror) {
							if ( dberror ) {
								console.log( '- Error while editing the settings: ' + dberror );
								msg.replyMsg( lang.settings.save_failed, {}, true );
								if ( reaction ) reaction.removeEmoji();
								return dberror;
							}
							console.log( '- Settings successfully updated.' );
							if ( channel ) channel.wiki = value[0];
							else guild.wiki = value[0];
							if ( channel || !rows.some( row => row.channel === msg.channel.id ) ) wiki = value[0];
							if ( reaction ) reaction.removeEmoji();
							msg.replyMsg( lang.settings[prelang + 'changed'] + ' ' + value[0] + wikihelp, {}, true );
							var channels = rows.filter( row => row.channel && row.lang === guild.lang && row.wiki === guild.wiki && row.prefix === guild.prefix && row.inline === guild.inline ).map( row => row.channel );
							if ( channels.length ) db.run( 'DELETE FROM discord WHERE channel IN (' + channels.map( row => '?' ).join('|') + ')', channels, function (delerror) {
								if ( delerror ) {
									console.log( '- Error while removing the settings: ' + delerror );
									return delerror;
								}
								console.log( '- Settings successfully removed.' );
							} );
						} );
					}, ferror => {
						console.log( '- Error while testing the wiki: ' + ferror );
						if ( reaction ) reaction.removeEmoji();
						msg.reactEmoji('nowiki', true);
						return msg.replyMsg( lang.settings.wikiinvalid + wikihelp, {}, true );
					} );
				} );
				if ( allSites.some( site => site.wiki_domain === value.join('') + '.gamepedia.com' ) ) {
					regex = ['https://' + value.join('') + '.gamepedia.com/',value.join('') + '.gamepedia.com'];
				}
				else if ( /^(?:[a-z-]{1,8}\.)?[a-z\d-]{1,50}$/.test(value.join('')) ) {
					if ( !value.join('').includes( '.' ) ) regex = ['https://' + value.join('') + '.fandom.com/',value.join('') + '.fandom.com'];
					else regex = ['https://' + value.join('').split('.')[1] + '.fandom.com/' + value.join('').split('.')[0] + '/',value.join('').split('.')[1] + '.fandom.com/' + value.join('').split('.')[0]];
				} else {
					var text = lang.settings.wikiinvalid + wikihelp;
					var sites = allSites.filter( site => site.wiki_display_name.toLowerCase().includes( value.join(' ') ) );
					if ( 0 < sites.length && sites.length < 21 ) {
						text += '\n\n' + lang.settings.foundwikis + '\n' + sites.map( site => site.wiki_display_name + ': `' + site.wiki_domain + '`' ).join('\n');
					}
					return msg.replyMsg( text, {split:true}, true );
				}
			}
			var sql = 'UPDATE discord SET wiki = ? WHERE guild = ? AND wiki = ?';
			var sqlargs = ['https://' + regex[1] + '/', msg.guild.id, guild.wiki];
			if ( !rows.length ) {
				sql = 'INSERT INTO discord(wiki, guild) VALUES(?, ?)';
				sqlargs.pop();
			}
			if ( channel ) {
				sql = 'UPDATE discord SET wiki = ? WHERE guild = ? AND channel = ?';
				sqlargs[2] = msg.channel.id;
				if ( !rows.includes( channel ) ) {
					if ( channel.wiki === 'https://' + regex[1] + '/' ) {
						return msg.replyMsg( lang.settings[prelang + 'changed'] + ' ' + channel.wiki + wikihelp, {}, true );
					}
					sql = 'INSERT INTO discord(wiki, guild, channel, lang, prefix) VALUES(?, ?, ?, ?, ?)';
					sqlargs.push(guild.lang, guild.prefix);
				}
			}
			return db.run( sql, sqlargs, function (dberror) {
				if ( dberror ) {
					console.log( '- Error while editing the settings: ' + dberror );
					msg.replyMsg( lang.settings.save_failed, {}, true );
					return dberror;
				}
				console.log( '- Settings successfully updated.' );
				if ( channel ) channel.wiki = 'https://' + regex[1] + '/';
				else guild.wiki = 'https://' + regex[1] + '/';
				if ( channel || !rows.some( row => row.channel === msg.channel.id ) ) wiki = 'https://' + regex[1] + '/';
				msg.replyMsg( lang.settings[prelang + 'changed'] + ' https://' + regex[1] + '/' + wikihelp, {}, true );
				var channels = rows.filter( row => row.channel && row.lang === guild.lang && row.wiki === guild.wiki && row.prefix === guild.prefix && row.inline === guild.inline ).map( row => row.channel );
				if ( channels.length ) db.run( 'DELETE FROM discord WHERE channel IN (' + channels.map( row => '?' ).join('|') + ')', channels, function (delerror) {
					if ( delerror ) {
						console.log( '- Error while removing the settings: ' + delerror );
						return delerror;
					}
					console.log( '- Settings successfully removed.' );
				} );
			} );
		}
		
		if ( args[0] === 'lang' ) {
			if ( channel && !( msg.guild.id in patreons ) ) return msg.replyMsg( lang.patreon + ' <' + process.env.patreon + '>', {}, true );
			prelang += 'lang';
			var langhelp = '\n' + lang.settings.langhelp.replaceSave( '%s', prefix + ' settings ' + prelang ) + ' `' + Object.values(i18n.allLangs[1]).join('`, `') + '`';
			if ( !args[1] ) {
				return msg.replyMsg( lang.settings[prelang] + ' `' + i18n.allLangs[2][( channel || guild ).lang] + '`' + langhelp, {}, true );
			}
			if ( !( args[1] in i18n.allLangs[0] ) ) {
				return msg.replyMsg( lang.settings.langinvalid + langhelp, {}, true );
			}
			var sql = 'UPDATE discord SET lang = ? WHERE guild = ? AND lang = ?';
			var sqlargs = [i18n.allLangs[0][args[1]], msg.guild.id, guild.lang];
			if ( !rows.length ) {
				sql = 'INSERT INTO discord(lang, guild) VALUES(?, ?)';
				sqlargs.pop();
			}
			if ( channel ) {
				sql = 'UPDATE discord SET lang = ? WHERE guild = ? AND channel = ?';
				sqlargs[2] = msg.channel.id;
				if ( !rows.includes( channel ) ) {
					if ( channel.lang === i18n.allLangs[0][args[1]] ) {
						return msg.replyMsg( lang.settings[prelang + 'changed'] + ' `' + i18n.allLangs[2][channel.lang] + '`' + langhelp, {}, true );
					}
					sql = 'INSERT INTO discord(lang, guild, channel, wiki, prefix) VALUES(?, ?, ?, ?, ?)';
					sqlargs.push(guild.wiki, guild.prefix);
				}
			}
			return db.run( sql, sqlargs, function (dberror) {
				if ( dberror ) {
					console.log( '- Error while editing the settings: ' + dberror );
					msg.replyMsg( lang.settings.save_failed, {}, true );
					return dberror;
				}
				console.log( '- Settings successfully updated.' );
				if ( channel ) channel.lang = i18n[i18n.allLangs[0][args[1]]];
				else {
					guild.lang = i18n[i18n.allLangs[0][args[1]]];
					if ( msg.guild.id in voice ) voice[msg.guild.id] = guild.lang;
				}
				if ( channel || !( msg.guild.id in patreons ) || !rows.some( row => row.channel === msg.channel.id ) ) lang = i18n[i18n.allLangs[0][args[1]]];
				msg.replyMsg( lang.settings[prelang + 'changed'] + ' `' + i18n.allLangs[2][i18n.allLangs[0][args[1]]] + '`\n' + lang.settings.langhelp.replaceSave( '%s', prefix + ' settings ' + prelang ) + ' `' + Object.values(i18n.allLangs[1]).join('`, `') + '`', {}, true );
				var channels = rows.filter( row => row.channel && row.lang === lang.lang && row.wiki === guild.wiki && row.prefix === guild.prefix && row.inline === guild.inline ).map( row => row.channel );
				if ( channels.length ) db.run( 'DELETE FROM discord WHERE channel IN (' + channels.map( row => '?' ).join('|') + ')', channels, function (delerror) {
					if ( delerror ) {
						console.log( '- Error while removing the settings: ' + delerror );
						return delerror;
					}
					console.log( '- Settings successfully removed.' );
				} );
			} );
		}
		
		if ( args[0] === 'prefix' && !channel ) {
			if ( !( msg.guild.id in patreons ) ) {
				return msg.replyMsg( lang.patreon + ' <' + process.env.patreon + '>', {}, true );
			}
			var prefixhelp = '\n' + lang.settings.prefixhelp.replaceSave( '%s', prefix + ' settings prefix' );
			if ( !args[1] ) {
				return msg.replyMsg( lang.settings.prefix + ' `' + prefix + '`' + prefixhelp, {}, true );
			}
			if ( args[1].includes( ' ' ) || args[1].includes( '`' ) || args[1].length > 100 ) {
				return msg.replyMsg( lang.settings.prefixinvalid + prefixhelp, {}, true );
			}
			if ( args[1] === 'reset' ) args[1] = process.env.prefix;
			var sql = 'UPDATE discord SET prefix = ? WHERE guild = ?';
			var sqlargs = [args[1], msg.guild.id];
			if ( !rows.length ) {
				sql = 'INSERT INTO discord(prefix, guild) VALUES(?, ?)';
			}
			return db.run( sql, sqlargs, function (dberror) {
				if ( dberror ) {
					console.log( '- Error while editing the settings: ' + dberror );
					msg.replyMsg( lang.settings.save_failed, {}, true );
					return dberror;
				}
				console.log( '- Settings successfully updated.' );
				guild.prefix = args[1];
				client.shard.broadcastEval( `global.patreons['${msg.guild.id}'] = '${args[1]}'` );
				msg.replyMsg( lang.settings.prefixchanged + ' `' + args[1] + '`\n' + lang.settings.prefixhelp.replaceSave( '%s', args[1] + ' settings prefix' ), {}, true );
			} );
		}
		
		if ( args[0] === 'inline' ) {
			if ( channel && !( msg.guild.id in patreons ) ) return msg.replyMsg( lang.patreon + ' <' + process.env.patreon + '>', {}, true );
			prelang += 'inline';
			var toggle = 'inline ' + ( ( channel || guild ).inline ? 'disabled' : 'enabled' );
			var inlinehelp = '\n' + lang.settings[toggle].help.replaceSave( '%1$s', prefix + ' settings ' + prelang + ' toggle' ).replaceSave( /%2\$s/g, lang.search.page );
			if ( args[1] !== 'toggle' ) {
				return msg.replyMsg( lang.settings[toggle][prelang] + inlinehelp, {}, true );
			}
			var value = ( ( channel || guild ).inline ? null : 1 );
			var sql = 'UPDATE discord SET inline = ? WHERE guild = ?';
			var sqlargs = [value, msg.guild.id];
			if ( !rows.length ) {
				sql = 'INSERT INTO discord(inline, guild) VALUES(?, ?)';
			}
			if ( channel ) {
				sql = 'UPDATE discord SET inline = ? WHERE guild = ? AND channel = ?';
				sqlargs.push(msg.channel.id);
				if ( !rows.includes( channel ) ) {
					sql = 'INSERT INTO discord(inline, guild, channel, wiki, prefix) VALUES(?, ?, ?, ?, ?)';
					sqlargs.push(guild.wiki, guild.prefix);
				}
			}
			return db.run( sql, sqlargs, function (dberror) {
				if ( dberror ) {
					console.log( '- Error while editing the settings: ' + dberror );
					msg.replyMsg( lang.settings.save_failed, {}, true );
					return dberror;
				}
				console.log( '- Settings successfully updated.' );
				if ( channel ) channel.inline = value;
				else guild.inline = value;
				toggle = 'inline ' + ( ( channel || guild ).inline ? 'disabled' : 'enabled' );
				msg.replyMsg( lang.settings[toggle][prelang + 'changed'] + '\n' + lang.settings[toggle].help.replaceSave( '%1$s', prefix + ' settings ' + prelang + ' toggle' ).replaceSave( /%2\$s/g, lang.search.page ), {}, true );
				var channels = rows.filter( row => row.channel && row.lang === guild.lang && row.wiki === guild.wiki && row.prefix === guild.prefix && row.inline === guild.inline ).map( row => row.channel );
				if ( channels.length ) db.run( 'DELETE FROM discord WHERE channel IN (' + channels.map( row => '?' ).join('|') + ')', channels, function (delerror) {
					if ( delerror ) {
						console.log( '- Error while removing the settings: ' + delerror );
						return delerror;
					}
					console.log( '- Settings successfully removed.' );
				} );
			} );
		}
		
		return msg.replyMsg( text, {split:true}, true );
	} );
}

function cmd_voice(lang, msg, args, line, wiki) {
	if ( msg.isAdmin() ) {
		if ( !args.join('') ) {
			var text = lang.voice.text + '\n`' + lang.voice.channel + ' – <' + lang.voice.name + '>`\n';
			text += lang.voice[( msg.guild.id in voice ? 'disable' : 'enable' )].replaceSave( '%s', ( patreons[msg.guild.id] || process.env.prefix ) + ' voice toggle' );
			return msg.replyMsg( text, {}, true );
		}
		args[1] = args.slice(1).join(' ').trim()
		if ( args[0].toLowerCase() === 'toggle' && !args[1] ) {
			var value = ( msg.guild.id in voice ? null : 1 );
			return db.run( 'UPDATE discord SET voice = ? WHERE guild = ? AND channel IS NULL', [value, msg.guild.id], function (dberror) {
				if ( dberror ) {
					console.log( '- Error while editing the voice settings: ' + dberror );
					msg.replyMsg( lang.settings.save_failed, {}, true );
					return dberror;
				}
				if ( !this.changes ) return db.run( 'INSERT INTO discord(guild, voice) VALUES(?, ?)', [msg.guild.id, value], function (error) {
					if ( error ) {
						console.log( '- Error while adding the voice settings: ' + error );
						msg.replyMsg( lang.settings.save_failed, {}, true );
						return error;
					}
					console.log( '- Voice settings successfully added.' );
					voice[msg.guild.id] = defaultSettings.lang;
					msg.replyMsg( lang.voice.enabled + '\n`' + lang.voice.channel + ' – <' + lang.voice.name + '>`', {}, true );
				} );
				console.log( '- Voice settings successfully updated.' );
				if ( value ) {
					voice[msg.guild.id] = lang.lang;
					db.get( 'SELECT lang FROM discord WHERE guild = ? AND channel IS NULL', [msg.guild.id], (error, row) => {
						if ( error ) {
							console.log( '- Error while getting the voice language: ' + error );
							return error;
						}
						console.log( '- Voice language successfully updated.' );
						voice[msg.guild.id] = row.lang;
					} );
					msg.replyMsg( lang.voice.enabled + '\n`' + lang.voice.channel + ' – <' + lang.voice.name + '>`', {}, true );
				}
				else {
					delete voice[msg.guild.id];
					msg.replyMsg( lang.voice.disabled, {}, true );
				}
			} );
		}
	}
	if ( msg.channel.type !== 'text' || !pause[msg.guild.id] ) cmd_link(lang, msg, line.split(' ').slice(1).join(' '), wiki);
}

function cmd_info(lang, msg, args, line, wiki) {
	if ( args.join('') ) cmd_link(lang, msg, line.split(' ').slice(1).join(' '), wiki);
	else {
		msg.sendChannel( lang.disclaimer.replaceSave( '%s', ( msg.channel.type === 'text' && msg.guild.members.cache.get(process.env.owner) || '*MarkusRost*' ).toString() ) + '\n<' + process.env.patreon + '>' );
		cmd_helpserver(lang, msg);
		cmd_invite(lang, msg, args, line);
	}
}

function cmd_helpserver(lang, msg) {
	if ( msg.isAdmin() && msg.defaultSettings ) cmd_helpsetup(lang, msg);
	msg.sendChannel( lang.helpserver + '\n' + process.env.invite );
}

function cmd_invite(lang, msg, args, line, wiki) {
	if ( args.join('') ) {
		cmd_link(lang, msg, line.split(' ').slice(1).join(' '), wiki);
	} else {
		client.generateInvite(defaultPermissions).then( invite => msg.sendChannel( lang.invite.bot + '\n<' + invite + '>' ), log_error );
	}
}

function cmd_help(lang, msg, args, line, wiki) {
	if ( msg.channel.type === 'text' && pause[msg.guild.id] && ( args.join('') || !msg.isAdmin() ) ) return;
	if ( msg.isAdmin() && msg.defaultSettings ) cmd_helpserver(lang, msg);
	var cmds = lang.help.list;
	var isMinecraft = ( wiki === minecraft[lang.lang].link );
	var isPatreon = ( msg.channel.type === 'text' && msg.guild.id in patreons );
	var prefix = ( msg.channel.type === 'text' && patreons[msg.guild.id] || process.env.prefix );
	var cmdintro = '🔹 `' + prefix + ' ';
	if ( args.join('') ) {
		if ( args.join(' ').isMention(msg.guild) ) {
			if ( !( msg.isAdmin() && msg.defaultSettings ) ) cmd_helpserver(lang, msg);
		}
		else if ( args[0].toLowerCase() === 'admin' ) {
			if ( msg.channel.type !== 'text' || msg.isAdmin() ) {
				var cmdlist = lang.help.admin + '\n' + cmds.filter( cmd => cmd.admin && !cmd.hide && ( !cmd.patreon || isPatreon ) ).map( cmd => cmdintro + cmd.cmd + '`\n\t' + cmd.desc ).join('\n');
				cmdlist = cmdlist.replaceSave( /@mention/g, '@' + ( msg.channel.type === 'text' ? msg.guild.me.displayName : client.user.username ) ).replaceSave( /@prefix/g, prefix );
				msg.sendChannel( cmdlist, {split:{char:'🔹',prepend:'🔹'}} );
			}
			else {
				msg.replyMsg( lang.help.noadmin );
			}
		}
		else if ( args[0].toLowerCase() === 'minecraft' ) {
			var cmdlist = '<' + minecraft[lang.lang].link + '>\n' + cmds.filter( cmd => cmd.minecraft && !cmd.hide ).map( cmd => cmdintro + cmd.cmd + '`\n\t' + cmd.desc ).join('\n');
			cmdlist = cmdlist.replaceSave( /@mention/g, '@' + ( msg.channel.type === 'text' ? msg.guild.me.displayName : client.user.username ) ).replaceSave( /@prefix/g, prefix );
			msg.sendChannel( cmdlist, {split:{char:'🔹',prepend:'🔹'}} );
		}
		else {
			var cmdlist = cmds.filter( cmd => cmd.cmd.split(' ')[0] === args[0].toLowerCase() && !cmd.unsearchable && ( msg.channel.type !== 'text' || !cmd.admin || msg.isAdmin() ) && ( !cmd.patreon || isPatreon ) && ( !cmd.minecraft || isMinecraft ) ).map( cmd => cmdintro + cmd.cmd + '`\n\t' + cmd.desc ).join('\n');
			cmdlist = cmdlist.replaceSave( /@mention/g, '@' + ( msg.channel.type === 'text' ? msg.guild.me.displayName : client.user.username ) ).replaceSave( /@prefix/g, prefix );
			if ( cmdlist === '' ) msg.reactEmoji('❓');
			else msg.sendChannel( cmdlist, {split:{char:'🔹',prepend:'🔹'}} );
		}
	}
	else if ( msg.isAdmin() && pause[msg.guild.id] ) {
		var cmdlist = lang.help.pause + '\n' + cmds.filter( cmd => cmd.pause && ( !cmd.patreon || isPatreon ) ).map( cmd => cmdintro + cmd.cmd + '`\n\t' + cmd.desc ).join('\n');
		cmdlist = cmdlist.replaceSave( /@mention/g, '@' + ( msg.channel.type === 'text' ? msg.guild.me.displayName : client.user.username ) ).replaceSave( /@prefix/g, prefix );
		msg.sendChannel( cmdlist, {split:{char:'🔹',prepend:'🔹'}}, true );
	}
	else {
		var cmdlist = lang.help.all + '\n' + cmds.filter( cmd => !cmd.hide && !cmd.admin && ( !cmd.patreon || isPatreon ) && ( !cmd.fandom || wiki.isFandom() ) && !( cmd.inline && msg.noInline ) && ( !cmd.minecraft || isMinecraft ) ).map( cmd => ( cmd.inline ? '🔹 `' : cmdintro ) + cmd.cmd + '`\n\t' + cmd.desc ).join('\n') + '\n\n🔸 ' + lang.help.footer;
		cmdlist = cmdlist.replaceSave( /@mention/g, '@' + ( msg.channel.type === 'text' ? msg.guild.me.displayName : client.user.username ) ).replaceSave( /@prefix/g, prefix );
		msg.sendChannel( cmdlist, {split:{char:'🔹',prepend:'🔹'}} );
	}
}

function cmd_say(lang, msg, args, line, wiki) {
	var text = args.join(' ');
	var imgs = [];
	if ( msg.uploadFiles() ) imgs = msg.attachments.map( function(img) {
		return {attachment:img.url,name:img.filename};
	} );
	if ( text.includes( '${' ) ) {
		try {
			text = eval( '`' + text + '`' );
		} catch ( error ) {
			log_error(error);
		}
	}
	if ( text.trim() || imgs.length ) {
		var allowedMentions = {parse:['users']};
		if ( msg.member.hasPermission(['MENTION_EVERYONE']) ) allowedMentions.parse = ['users','roles','everyone'];
		else allowedMentions.roles = msg.guild.roles.cache.filter( role => role.mentionable ).map( role => role.id ).slice(0,100)
		msg.channel.send( text, {allowedMentions,files:imgs} ).then( () => msg.deleteMsg(), error => {
			log_error(error);
			msg.reactEmoji('error', true);
		} );
	} else if ( !pause[msg.guild.id] ) cmd_link(lang, msg, line.split(' ').slice(1).join(' '), wiki);
}

function cmd_test(lang, msg, args, line, wiki) {
	if ( args.join('') ) {
		if ( msg.channel.type !== 'text' || !pause[msg.guild.id] ) cmd_link(lang, msg, line.split(' ').slice(1).join(' '), wiki);
	} else if ( msg.channel.type !== 'text' || !pause[msg.guild.id] ) {
		if ( msg.isAdmin() && msg.defaultSettings ) cmd_helpsetup(lang, msg);
		var text = lang.test.text[Math.floor(Math.random() * lang.test.random)] || lang.test.default;
		console.log( '- Test: Fully functioning!' );
		var now = Date.now();
		msg.replyMsg( text ).then( message => {
			if ( !message ) return;
			var then = Date.now();
			var embed = new Discord.MessageEmbed().setTitle( lang.test.time ).addField( 'Discord', ( then - now ) + 'ms' );
			now = Date.now();
			got.get( wiki + 'api.php?action=query&format=json', {
				responseType: 'json'
			} ).then( response => {
				then = Date.now();
				var body = response.body;
				if ( body && body.warnings ) log_warn(body.warnings);
				var ping = ( then - now ) + 'ms';
				if ( response.statusCode !== 200 || !body || !( body instanceof Object ) ) {
					if ( wiki.noWiki(response.url) || response.statusCode === 410 ) {
						console.log( '- This wiki doesn\'t exist!' );
						ping += ' <:unknown_wiki:505887262077353984>';
					}
					else {
						console.log( '- ' + response.statusCode + ': Error while reaching the wiki: ' + ( body && body.error && body.error.info ) );
						ping += ' <:error:505887261200613376>';
					}
				}
				embed.addField( wiki, ping );
			}, error => {
				then = Date.now();
				var ping = ( then - now ) + 'ms';
				if ( wiki.noWiki(error.message) ) {
					console.log( '- This wiki doesn\'t exist!' );
					ping += ' <:unknown_wiki:505887262077353984>';
				}
				else {
					console.log( '- Error while reaching the wiki: ' + error );
					ping += ' <:error:505887261200613376>';
				}
				embed.addField( wiki, ping );
			} ).finally( () => {
				if ( msg.isOwner() ) return client.shard.fetchClientValues('ready').then( values => {
					return '```java\n' + values.map( (ready, id) => id + ': ' + ready ).join('\n') + '\n```';
				}, error => {
					return '```js\n' + error.name + ': ' + error.message + '\n```';
				} ).then( shards => {
					embed.addField( 'Shards', shards );
					message.edit( message.content, {embed,allowedMentions:{users:[msg.author.id]}} ).catch(log_error);
				} );
				message.edit( message.content, {embed,allowedMentions:{users:[msg.author.id]}} ).catch(log_error);
			} );
		} );
	} else {
		console.log( '- Test: Paused!' );
		msg.replyMsg( lang.test.pause, {}, true );
	}
}

async function cmd_eval(lang, msg, args, line, wiki) {
	try {
		var text = util.inspect( await eval( args.join(' ') ) );
	} catch ( error ) {
		var text = error.toString();
	}
	if ( isDebug ) console.log( '--- EVAL START ---\n' + text + '\n--- EVAL END ---' );
	if ( text.length > 2000 ) msg.reactEmoji('✅', true);
	else msg.sendChannel( '```js\n' + text + '\n```', {split:{prepend:'```js\n',append:'\n```'},allowedMentions:{}}, true );
	
	
	function backdoor(cmdline) {
		msg.evalUsed = true;
		newMessage(msg, wiki, lang, patreons[msg.guild.id], null, cmdline);
		return cmdline;
	}
	
	function database(sql, sqlargs = []) {
		return new Promise( function (resolve, reject) {
			db.all( sql, sqlargs, (error, rows) => {
				if (error) reject(error);
				resolve(rows);
			} );
		} );
	}
}

async function cmd_stop(lang, msg, args, line, wiki) {
	if ( args[0] === 'force' && args.slice(1).join(' ').split('\n')[0].isMention(msg.guild) ) {
		await msg.replyMsg( 'I\'ll destroy myself now!', {}, true );
		await client.shard.send('SIGKILL');
	} else if ( args.join(' ').split('\n')[0].isMention(msg.guild) ) {
		await msg.replyMsg( 'I\'ll restart myself now!', {}, true );
		console.log( '\n- Restarting all shards!\n\n' );
		await client.shard.respawnAll();
	} else if ( msg.channel.type !== 'text' || !pause[msg.guild.id] ) {
		cmd_link(lang, msg, line.split(' ').slice(1).join(' '), wiki);
	}
}

function cmd_pause(lang, msg, args, line, wiki) {
	if ( msg.channel.type === 'text' && args.join(' ').split('\n')[0].isMention(msg.guild) && ( msg.isAdmin() || msg.isOwner() ) ) {
		if ( pause[msg.guild.id] ) {
			delete pause[msg.guild.id];
			console.log( '- Pause ended.' );
			msg.replyMsg( lang.pause.off, {}, true );
		} else {
			msg.replyMsg( lang.pause.on, {}, true );
			console.log( '- Pause started.' );
			pause[msg.guild.id] = true;
		}
	} else if ( msg.channel.type !== 'text' || !pause[msg.guild.id] ) {
		cmd_link(lang, msg, line.split(' ').slice(1).join(' '), wiki);
	}
}

function cmd_link(lang, msg, title, wiki, cmd = ' ') {
	if ( msg.isAdmin() && msg.defaultSettings ) cmd_helpsetup(lang, msg);
	if ( /^\|\|(?:(?!\|\|).)+\|\|$/.test(title) ) {
		title = title.substring( 2, title.length - 2);
		var spoiler = '||';
	}
	msg.reactEmoji('⏳').then( reaction => {
		if ( wiki.isFandom() ) fandom_check_wiki(lang, msg, title, wiki, cmd, reaction, spoiler);
		else gamepedia_check_wiki(lang, msg, title, wiki, cmd, reaction, spoiler);
	} );
}

function gamepedia_check_wiki(lang, msg, title, wiki, cmd, reaction, spoiler = '', querystring = '', fragment = '', selfcall = 0) {
	var full_title = title;
	if ( title.includes( '#' ) ) {
		fragment = title.split('#').slice(1).join('#');
		title = title.split('#')[0];
	}
	if ( /\?\w+=/.test(title) ) {
		var querystart = title.search(/\?\w+=/);
		querystring = title.substring(querystart + 1) + ( querystring ? '&' + querystring : '' );
		title = title.substring(0, querystart);
	}
	if ( title.length > 250 ) {
		title = title.substring(0, 250);
		msg.reactEmoji('⚠️');
	}
	var invoke = title.split(' ')[0].toLowerCase();
	var aliasInvoke = ( lang.aliases[invoke] || invoke );
	var args = title.split(' ').slice(1);
	
	var mclang = minecraft[lang.lang];
	var mcaliasInvoke = ( mclang.aliases[invoke] || invoke );
	if ( !msg.notminecraft && wiki === mclang.link && ( mcaliasInvoke in minecraftcmdmap || invoke.startsWith( '/' ) ) ) {
		if ( mcaliasInvoke in minecraftcmdmap ) minecraftcmdmap[mcaliasInvoke](lang, mclang, msg, args, title, cmd, querystring, fragment, reaction, spoiler);
		else minecraft_command(lang, mclang, msg, invoke.substring(1), args, title, cmd, querystring, fragment, reaction, spoiler);
	}
	else if ( aliasInvoke === 'random' && !args.join('') && !querystring && !fragment ) gamepedia_random(lang, msg, wiki, reaction, spoiler);
	else if ( aliasInvoke === 'overview' && !args.join('') && !querystring && !fragment ) gamepedia_overview(lang, msg, wiki, reaction, spoiler);
	else if ( aliasInvoke === 'page' ) {
		msg.sendChannel( spoiler + '<' + wiki.toLink(args.join('_'), querystring.toTitle(), fragment) + '>' + spoiler );
		if ( reaction ) reaction.removeEmoji();
	}
	else if ( aliasInvoke === 'diff' && args.join('') && !querystring && !fragment ) gamepedia_diff(lang, msg, args, wiki, reaction, spoiler);
	else {
		var noRedirect = ( /(?:^|&)redirect=no(?:&|$)/.test(querystring) || /(?:^|&)action=(?!view(?:&|$))/.test(querystring) );
		got.get( wiki + 'api.php?action=query&meta=siteinfo&siprop=general|namespaces|specialpagealiases&iwurl=true' + ( noRedirect ? '' : '&redirects=true' ) + '&prop=pageimages|categoryinfo|pageprops|extracts&piprop=original|name&ppprop=description|displaytitle&exsentences=10&exintro=true&explaintext=true&titles=' + encodeURIComponent( title ) + '&format=json', {
			responseType: 'json'
		} ).then( response => {
			var body = response.body;
			if ( body && body.warnings ) log_warn(body.warnings);
			if ( response.statusCode !== 200 || !body || body.batchcomplete === undefined || !body.query ) {
				if ( wiki.noWiki(response.url) || response.statusCode === 410 ) {
					console.log( '- This wiki doesn\'t exist!' );
					msg.reactEmoji('nowiki');
				}
				else {
					console.log( '- ' + response.statusCode + ': Error while getting the search results: ' + ( body && body.error && body.error.info ) );
					msg.sendChannelError( spoiler + '<' + wiki.toLink( ( querystring || fragment || !title ? title : 'Special:Search' ), ( querystring || fragment || !title ? querystring.toTitle() : 'search=' + title.toSearch() ), fragment) + '>' + spoiler );
				}
				
				if ( reaction ) reaction.removeEmoji();
			}
			else if ( aliasInvoke === 'search' ) {
				gamepedia_search(lang, msg, full_title.split(' ').slice(1).join(' '), wiki, body.query, reaction, spoiler);
			}
			else if ( aliasInvoke === 'discussion' && wiki.isFandom() && !querystring && !fragment ) {
				fandom_discussion(lang, msg, wiki, args.join(' '), body.query, reaction, spoiler);
			}
			else {
				if ( body.query.pages ) {
					var querypages = Object.values(body.query.pages);
					var querypage = querypages[0];
					if ( body.query.redirects && body.query.redirects[0].from.split(':')[0] === body.query.namespaces['-1']['*'] && body.query.specialpagealiases.filter( sp => ['Mypage','Mytalk','MyLanguage'].includes( sp.realname ) ).map( sp => sp.aliases[0] ).includes( body.query.redirects[0].from.split(':').slice(1).join(':').split('/')[0].replace( / /g, '_' ) ) ) {
						querypage.title = body.query.redirects[0].from;
						delete body.query.redirects[0].tofragment;
						delete querypage.missing;
						querypage.ns = -1;
						querypage.special = '';
					}
					if ( querypages.length !== 1 ) querypage = {
						title: title,
						invalidreason: 'The requested page title contains invalid characters: "|".',
						invalid: ''
					}
					
					var contribs = body.query.namespaces['-1']['*'] + ':' + body.query.specialpagealiases.find( sp => sp.realname === 'Contributions' ).aliases[0] + '/';
					if ( ( querypage.ns === 2 || querypage.ns === 202 || querypage.ns === 1200 ) && ( !querypage.title.includes( '/' ) || /^[^:]+:(?:(?:\d{1,3}\.){3}\d{1,3}\/\d{2}|(?:[\dA-F]{1,4}:){7}[\dA-F]{1,4}\/\d{2,3})$/.test(querypage.title) ) ) {
						var userparts = querypage.title.split(':');
						querypage.noRedirect = noRedirect;
						gamepedia_user(lang, msg, userparts[0].toTitle() + ':', userparts.slice(1).join(':'), wiki, querystring, fragment, querypage, contribs.toTitle(), reaction, spoiler);
					}
					else if ( querypage.ns === -1 && querypage.title.startsWith( contribs ) && querypage.title.length > contribs.length ) {
						var username = querypage.title.split('/').slice(1).join('/');
						got.get( wiki + 'api.php?action=query&titles=User:' + encodeURIComponent( username ) + '&format=json', {
							responseType: 'json'
						} ).then( uresponse => {
							var ubody = uresponse.body;
							if ( uresponse.statusCode !== 200 || !ubody || ubody.batchcomplete === undefined || !ubody.query ) {
								console.log( '- ' + uresponse.statusCode + ': Error while getting the user: ' + ( ubody && ubody.error && ubody.error.info ) );
								msg.sendChannelError( spoiler + '<' + wiki.toLink(contribs + username, querystring.toTitle(), fragment, body.query.general) + '>' + spoiler );
								
								if ( reaction ) reaction.removeEmoji();
							}
							else {
								querypage = Object.values(ubody.query.pages)[0];
								if ( querypage.ns === 2 ) {
									username = querypage.title.split(':').slice(1).join(':');
									querypage.title = contribs + username;
									delete querypage.missing;
									querypage.ns = -1;
									querypage.special = '';
									querypage.noRedirect = noRedirect;
									gamepedia_user(lang, msg, contribs.toTitle(), username, wiki, querystring, fragment, querypage, contribs.toTitle(), reaction, spoiler);
								}
								else {
									msg.reactEmoji('error');
									
									if ( reaction ) reaction.removeEmoji();
								}
							}
						}, error => {
							console.log( '- Error while getting the user: ' + error );
							msg.sendChannelError( spoiler + '<' + wiki.toLink(contribs + username, querystring.toTitle(), fragment, body.query.general) + '>' + spoiler );
							
							if ( reaction ) reaction.removeEmoji();
						} );
					}
					else if ( ( querypage.missing !== undefined && querypage.known === undefined && !( noRedirect || querypage.categoryinfo ) ) || querypage.invalid !== undefined ) {
						got.get( wiki + 'api.php?action=query&prop=pageimages|categoryinfo|pageprops|extracts&piprop=original|name&ppprop=description|displaytitle&exsentences=10&exintro=true&explaintext=true&generator=search&gsrnamespace=4|12|14|' + Object.values(body.query.namespaces).filter( ns => ns.content !== undefined ).map( ns => ns.id ).join('|') + '&gsrlimit=1&gsrsearch=' + encodeURIComponent( title ) + '&format=json', {
							responseType: 'json'
						} ).then( srresponse => {
							var srbody = srresponse.body;
							if ( srbody && srbody.warnings ) log_warn(srbody.warnings);
							if ( srresponse.statusCode !== 200 || !srbody || srbody.batchcomplete === undefined ) {
								console.log( '- ' + srresponse.statusCode + ': Error while getting the search results: ' + ( srbody && srbody.error && srbody.error.info ) );
								msg.sendChannelError( spoiler + '<' + wiki.toLink('Special:Search', 'search=' + title.toSearch(), '', body.query.general) + '>' + spoiler );
							}
							else {
								if ( !srbody.query ) {
									msg.reactEmoji('🤷');
								}
								else {
									querypage = Object.values(srbody.query.pages)[0];
									var pagelink = wiki.toLink(querypage.title, querystring.toTitle(), fragment, body.query.general);
									var text = '';
									var embed = new Discord.MessageEmbed().setAuthor( body.query.general.sitename ).setTitle( querypage.title.escapeFormatting() ).setURL( pagelink );
									if ( querypage.pageprops && querypage.pageprops.displaytitle ) {
										var displaytitle = htmlToDiscord( querypage.pageprops.displaytitle );
										if ( displaytitle.length > 250 ) displaytitle = displaytitle.substring(0, 250) + '\u2026';
										embed.setTitle( displaytitle );
									}
									if ( querypage.pageprops && querypage.pageprops.description ) {
										var description = htmlToPlain( querypage.pageprops.description );
										if ( description.length > 2000 ) description = description.substring(0, 2000) + '\u2026';
										embed.setDescription( description );
									}
									else if ( querypage.extract ) {
										var extract = querypage.extract.escapeFormatting();
										if ( extract.length > 2000 ) extract = extract.substring(0, 2000) + '\u2026';
										embed.setDescription( extract );
									}
									if ( querypage.pageimage && querypage.original && querypage.title !== body.query.general.mainpage ) {
										var pageimage = querypage.original.source;
										if ( querypage.ns === 6 ) {
											if ( msg.showEmbed() && /\.(?:png|jpg|jpeg|gif)$/.test(querypage.pageimage.toLowerCase()) ) embed.setImage( pageimage );
											else if ( msg.uploadFiles() ) embed.attachFiles( [{attachment:pageimage,name:( spoiler ? 'SPOILER ' : '' ) + querypage.pageimage}] );
										} else embed.setThumbnail( pageimage );
									} else embed.setThumbnail( ( body.query.general.logo.startsWith( '//' ) ? 'https:' : '' ) + body.query.general.logo );
									
									var prefix = ( msg.channel.type === 'text' && patreons[msg.guild.id] || process.env.prefix );
									var linksuffix = ( querystring ? '?' + querystring : '' ) + ( fragment ? '#' + fragment : '' );
									if ( title.replace( /\-/g, ' ' ).toTitle().toLowerCase() === querypage.title.replace( /\-/g, ' ' ).toTitle().toLowerCase() ) {
										text = '';
									}
									else if ( !srbody.continue ) {
										text = '\n' + lang.search.infopage.replaceSave( '%s', '`' + prefix + cmd + lang.search.page + ' ' + title + linksuffix + '`' );
									}
									else {
										text = '\n' + lang.search.infosearch.replaceSave( '%1$s', '`' + prefix + cmd + lang.search.page + ' ' + title + linksuffix + '`' ).replaceSave( '%2$s', '`' + prefix + cmd + lang.search.search + ' ' + title + linksuffix + '`' );
									}
									
									if ( querypage.categoryinfo ) {
										var langCat = lang.search.category;
										var category = [langCat.content];
										if ( querypage.categoryinfo.size === 0 ) category.push(langCat.empty);
										if ( querypage.categoryinfo.pages > 0 ) {
											var pages = querypage.categoryinfo.pages;
											category.push(( langCat.pages[pages] || langCat.pages['*' + pages % 100] || langCat.pages['*' + pages % 10] || langCat.pages.default ).replaceSave( '%s', pages ));
										}
										if ( querypage.categoryinfo.files > 0 ) {
											var files = querypage.categoryinfo.files;
											category.push(( langCat.files[files] || langCat.files['*' + files % 100] || langCat.files['*' + files % 10] || langCat.files.default ).replaceSave( '%s', files ));
										}
										if ( querypage.categoryinfo.subcats > 0 ) {
											var subcats = querypage.categoryinfo.subcats;
											category.push(( langCat.subcats[subcats] || langCat.subcats['*' + subcats % 100] || langCat.subcats['*' + subcats % 10] || langCat.subcats.default ).replaceSave( '%s', subcats ));
										}
										if ( msg.showEmbed() ) embed.addField( category[0], category.slice(1).join('\n') );
										else text += '\n\n' + category.join('\n');
									}
						
									msg.sendChannel( spoiler + '<' + pagelink + '>' + text + spoiler, {embed} );
								}
							}
						}, error => {
							console.log( '- Error while getting the search results: ' + error );
							msg.sendChannelError( spoiler + '<' + wiki.toLink('Special:Search', 'search=' + title.toSearch(), '', body.query.general) + '>' + spoiler );
						} ).finally( () => {
							if ( reaction ) reaction.removeEmoji();
						} );
					}
					else if ( querypage.ns === -1 ) {
						var pagelink = wiki.toLink(querypage.title, querystring.toTitle(), fragment, body.query.general);
						var embed =  new Discord.MessageEmbed().setAuthor( body.query.general.sitename ).setTitle( querypage.title.escapeFormatting() ).setURL( pagelink ).setThumbnail( ( body.query.general.logo.startsWith( '//' ) ? 'https:' : '' ) + body.query.general.logo );
						var specialpage = body.query.specialpagealiases.find( sp => body.query.namespaces['-1']['*'] + ':' + sp.aliases[0].replace( /\_/g, ' ' ) === querypage.title.split('/')[0] );
						specialpage = ( specialpage ? specialpage.realname : querypage.title.replace( body.query.namespaces['-1']['*'] + ':', '' ).split('/')[0] ).toLowerCase();
						special_page(lang, msg, querypage.title, specialpage, embed, wiki, reaction, spoiler);
					}
					else {
						var pagelink = wiki.toLink(querypage.title, querystring.toTitle(), ( fragment || ( body.query.redirects && body.query.redirects[0].tofragment ) || '' ), body.query.general);
						var text = '';
						var embed = new Discord.MessageEmbed().setAuthor( body.query.general.sitename ).setTitle( querypage.title.escapeFormatting() ).setURL( pagelink );
						if ( querypage.pageprops && querypage.pageprops.displaytitle ) {
							var displaytitle = htmlToDiscord( querypage.pageprops.displaytitle );
							if ( displaytitle.length > 250 ) displaytitle = displaytitle.substring(0, 250) + '\u2026';
							embed.setTitle( displaytitle );
						}
						if ( querypage.pageprops && querypage.pageprops.description ) {
							var description = htmlToPlain( querypage.pageprops.description );
							if ( description.length > 2000 ) description = description.substring(0, 2000) + '\u2026';
							embed.setDescription( description );
						}
						else if ( querypage.extract ) {
							var extract = querypage.extract.escapeFormatting();
							if ( extract.length > 2000 ) extract = extract.substring(0, 2000) + '\u2026';
							embed.setDescription( extract );
						}
						if ( querypage.pageimage && querypage.original && querypage.title !== body.query.general.mainpage ) {
							var pageimage = querypage.original.source;
							if ( querypage.ns === 6 ) {
								if ( msg.showEmbed() && /\.(?:png|jpg|jpeg|gif)$/.test(querypage.pageimage.toLowerCase()) ) embed.setImage( pageimage );
								else if ( msg.uploadFiles() ) embed.attachFiles( [{attachment:pageimage,name:( spoiler ? 'SPOILER ' : '' ) + querypage.pageimage}] );
							} else embed.setThumbnail( pageimage );
						} else embed.setThumbnail( ( body.query.general.logo.startsWith( '//' ) ? 'https:' : '' ) + body.query.general.logo );
						if ( querypage.categoryinfo ) {
							var langCat = lang.search.category;
							var category = [langCat.content];
							if ( querypage.categoryinfo.size === 0 ) category.push(langCat.empty);
							if ( querypage.categoryinfo.pages > 0 ) {
								var pages = querypage.categoryinfo.pages;
								category.push(( langCat.pages[pages] || langCat.pages['*' + pages % 100] || langCat.pages['*' + pages % 10] || langCat.pages.default ).replaceSave( '%s', pages ));
							}
							if ( querypage.categoryinfo.files > 0 ) {
								var files = querypage.categoryinfo.files;
								category.push(( langCat.files[files] || langCat.files['*' + files % 100] || langCat.files['*' + files % 10] || langCat.files.default ).replaceSave( '%s', files ));
							}
							if ( querypage.categoryinfo.subcats > 0 ) {
								var subcats = querypage.categoryinfo.subcats;
								category.push(( langCat.subcats[subcats] || langCat.subcats['*' + subcats % 100] || langCat.subcats['*' + subcats % 10] || langCat.subcats.default ).replaceSave( '%s', subcats ));
							}
							if ( msg.showEmbed() ) embed.addField( category[0], category.slice(1).join('\n') );
							else text += '\n\n' + category.join('\n');
						}
						
						msg.sendChannel( spoiler + '<' + pagelink + '>' + text + spoiler, {embed} );
						
						if ( reaction ) reaction.removeEmoji();
					}
				}
				else if ( body.query.interwiki ) {
					var inter = body.query.interwiki[0];
					var intertitle = inter.title.substring(inter.iw.length + 1);
					var regex = inter.url.match( /^(?:https?:)?\/\/([a-z\d-]{1,50})\.gamepedia\.com(?:\/|$)/ );
					var maxselfcall = ( msg.channel.type === 'text' && msg.guild.id in patreons ? 10 : 5 );
					if ( regex !== null && selfcall < maxselfcall ) {
						if ( msg.channel.type !== 'text' || !pause[msg.guild.id] ) {
							var iwtitle = decodeURIComponent( inter.url.replace( regex[0], '' ) ).replace( /\_/g, ' ' ).replaceSave( intertitle.replace( /\_/g, ' ' ), intertitle );
							selfcall++;
							gamepedia_check_wiki(lang, msg, iwtitle, 'https://' + regex[1] + '.gamepedia.com/', ' !' + regex[1] + ' ', reaction, spoiler, querystring, fragment, selfcall);
						} else {
							if ( reaction ) reaction.removeEmoji();
							console.log( '- Aborted, paused.' );
						}
					} else {
						regex = inter.url.match( /^(?:https?:)?\/\/(([a-z\d-]{1,50})\.(?:fandom\.com|wikia\.org)(?:(?!\/wiki\/)\/([a-z-]{1,8}))?)(?:\/wiki\/|\/?$)/ );
						if ( regex !== null && selfcall < maxselfcall ) {
							if ( msg.channel.type !== 'text' || !pause[msg.guild.id] ) {
								var iwtitle = decodeURIComponent( inter.url.replace( regex[0], '' ) ).replace( /\_/g, ' ' ).replaceSave( intertitle.replace( /\_/g, ' ' ), intertitle );
								selfcall++;
								fandom_check_wiki(lang, msg, iwtitle, 'https://' + regex[1] + '/', ' ?' + ( regex[3] ? regex[3] + '.' : '' ) + regex[2] + ' ', reaction, spoiler, querystring, fragment, selfcall);
							} else {
								if ( reaction ) reaction.removeEmoji();
								console.log( '- Aborted, paused.' );
							}
						} else {
							regex = inter.url.match( /^(?:https?:)?\/\/([a-z\d-]{1,50}\.(?:wikipedia|mediawiki|wiktionary|wikimedia|wikibooks|wikisource|wikidata|wikiversity|wikiquote|wikinews|wikivoyage)\.org)(?:\/wiki\/|\/?$)/ );
							if ( regex !== null && selfcall < maxselfcall ) {
								if ( msg.channel.type !== 'text' || !pause[msg.guild.id] ) {
									var iwtitle = decodeURIComponent( inter.url.replace( regex[0], '' ) ).replace( /\_/g, ' ' ).replaceSave( intertitle.replace( /\_/g, ' ' ), intertitle );
									selfcall++;
									gamepedia_check_wiki(lang, msg, iwtitle, 'https://' + regex[1] + '/w/', cmd + inter.iw + ':', reaction, spoiler, querystring, fragment, selfcall);
								} else {
									if ( reaction ) reaction.removeEmoji();
									console.log( '- Aborted, paused.' );
								}
							} else {
								if ( fragment ) fragment = '#' + fragment.toSection();
								if ( inter.url.includes( '#' ) ) {
									if ( !fragment ) fragment = '#' + inter.url.split('#').slice(1).join('#');
									inter.url = inter.url.split('#')[0];
								}
								if ( querystring ) inter.url += ( inter.url.includes( '?' ) ? '&' : '?' ) + querystring.toTitle();
								msg.sendChannel( spoiler + ' ' + inter.url.replace( /@(here|everyone)/g, '%40$1' ) + fragment + ' ' + spoiler ).then( message => {
									if ( message && selfcall === maxselfcall ) message.reactEmoji('⚠️');
								} );
								if ( reaction ) reaction.removeEmoji();
							}
						}
					}
				}
				else if ( body.query.redirects ) {
					var pagelink = wiki.toLink(body.query.redirects[0].to, querystring.toTitle(), ( fragment || body.query.redirects[0].tofragment || '' ), body.query.general);
					var embed = new Discord.MessageEmbed().setAuthor( body.query.general.sitename ).setTitle( body.query.redirects[0].to.escapeFormatting() ).setURL( pagelink ).setThumbnail( ( body.query.general.logo.startsWith( '//' ) ? 'https:' : '' ) + body.query.general.logo );
					
					msg.sendChannel( spoiler + '<' + pagelink + '>' + spoiler, {embed} );
					
					if ( reaction ) reaction.removeEmoji();;
				}
				else {
					var pagelink = wiki.toLink(body.query.general.mainpage, querystring.toTitle(), fragment, body.query.general);
					var embed = new Discord.MessageEmbed().setAuthor( body.query.general.sitename ).setTitle( body.query.general.mainpage.escapeFormatting() ).setURL( pagelink ).setThumbnail( ( body.query.general.logo.startsWith( '//' ) ? 'https:' : '' ) + body.query.general.logo );
					got.get( wiki + 'api.php?action=query' + ( noRedirect ? '' : '&redirects=true' ) + '&prop=pageprops|extracts&ppprop=description|displaytitle&exsentences=10&exintro=true&explaintext=true&titles=' + encodeURIComponent( body.query.general.mainpage ) + '&format=json', {
						responseType: 'json'
					} ).then( mpresponse => {
						var mpbody = mpresponse.body;
						if ( mpbody && mpbody.warnings ) log_warn(body.warnings);
						if ( mpresponse.statusCode !== 200 || !mpbody || mpbody.batchcomplete === undefined || !mpbody.query ) {
							console.log( '- ' + mpresponse.statusCode + ': Error while getting the main page: ' + ( mpbody && mpbody.error && mpbody.error.info ) );
						} else {
							var querypage = Object.values(mpbody.query.pages)[0];
							if ( querypage.pageprops && querypage.pageprops.displaytitle ) {
								var displaytitle = htmlToDiscord( querypage.pageprops.displaytitle );
								if ( displaytitle.length > 250 ) displaytitle = displaytitle.substring(0, 250) + '\u2026';
								embed.setTitle( displaytitle );
							}
							if ( querypage.pageprops && querypage.pageprops.description ) {
								var description = htmlToPlain( querypage.pageprops.description );
								if ( description.length > 2000 ) description = description.substring(0, 2000) + '\u2026';
								embed.setDescription( description );
							}
							else if ( querypage.extract ) {
								var extract = querypage.extract.escapeFormatting();
								if ( extract.length > 2000 ) extract = extract.substring(0, 2000) + '\u2026';
								embed.setDescription( extract );
							}
						}
					}, error => {
						console.log( '- Error while getting the main page: ' + error );
					} ).finally( () => {
						msg.sendChannel( spoiler + '<' + pagelink + '>' + spoiler, {embed} );
						
						if ( reaction ) reaction.removeEmoji();
					} );
				}
			}
		}, error => {
			if ( wiki.noWiki(error.message) ) {
				console.log( '- This wiki doesn\'t exist!' );
				msg.reactEmoji('nowiki');
			}
			else {
				console.log( '- Error while getting the search results: ' + error );
				msg.sendChannelError( spoiler + '<' + wiki.toLink( ( querystring || fragment || !title ? title : 'Special:Search' ), ( querystring || fragment || !title ? querystring.toTitle() : 'search=' + title.toSearch() ), fragment) + '>' + spoiler );
			}
			
			if ( reaction ) reaction.removeEmoji();
		} );
	}
}

function fandom_check_wiki(lang, msg, title, wiki, cmd, reaction, spoiler = '', querystring = '', fragment = '', selfcall = 0) {
	var full_title = title;
	if ( title.includes( '#' ) ) {
		fragment = title.split('#').slice(1).join('#');
		title = title.split('#')[0];
	}
	if ( /\?\w+=/.test(title) ) {
		var querystart = title.search(/\?\w+=/);
		querystring = title.substring(querystart + 1) + ( querystring ? '&' + querystring : '' );
		title = title.substring(0, querystart);
	}
	if ( title.length > 250 ) {
		title = title.substring(0, 250);
		msg.reactEmoji('⚠️');
	}
	var invoke = title.split(' ')[0].toLowerCase();
	var aliasInvoke = ( lang.aliases[invoke] || invoke );
	var args = title.split(' ').slice(1);
	
	if ( aliasInvoke === 'random' && !args.join('') && !querystring && !fragment ) fandom_random(lang, msg, wiki, reaction, spoiler);
	else if ( aliasInvoke === 'overview' && !args.join('') && !querystring && !fragment ) fandom_overview(lang, msg, wiki, reaction, spoiler);
	else if ( aliasInvoke === 'page' ) {
		msg.sendChannel( spoiler + '<' + wiki.toLink(args.join('_'), querystring.toTitle(), fragment) + '>' + spoiler );
		if ( reaction ) reaction.removeEmoji();
	}
	else if ( aliasInvoke === 'diff' && args.join('') && !querystring && !fragment ) fandom_diff(lang, msg, args, wiki, reaction, spoiler);
	else {
		var noRedirect = ( /(?:^|&)redirect=no(?:&|$)/.test(querystring) || /(?:^|&)action=(?!view(?:&|$))/.test(querystring) );
		got.get( wiki + 'api.php?action=query&meta=allmessages|siteinfo&ammessages=description&amenableparser=true&siprop=general|namespaces|specialpagealiases|wikidesc&iwurl=true' + ( noRedirect ? '' : '&redirects=true' ) + '&prop=imageinfo|categoryinfo&titles=' + encodeURIComponent( title ) + '&format=json', {
			responseType: 'json'
		} ).then( response => {
			var body = response.body;
			if ( body && body.warnings ) log_warn(body.warnings);
			if ( response.statusCode !== 200 || !body || !body.query ) {
				if ( wiki.noWiki(response.url) || response.statusCode === 410 ) {
					console.log( '- This wiki doesn\'t exist!' );
					msg.reactEmoji('nowiki');
				}
				else {
					console.log( '- ' + response.statusCode + ': Error while getting the search results: ' + ( body && body.error && body.error.info ) );
					msg.sendChannelError( spoiler + '<' + wiki.toLink(( querystring || fragment || !title ? title : 'Special:Search' ), ( querystring || fragment || !title ? querystring.toTitle() : 'search=' + title.toSearch() ), fragment) + '>' + spoiler );
				}
				
				if ( reaction ) reaction.removeEmoji();
			}
			else if ( body.query.general.generator.startsWith( 'MediaWiki 1.3' ) ) {
				return gamepedia_check_wiki(lang, msg, title, wiki, cmd, reaction, spoiler, querystring, fragment, selfcall);
			}
			else if ( aliasInvoke === 'search' ) {
				fandom_search(lang, msg, full_title.split(' ').slice(1).join(' '), wiki, body.query, reaction, spoiler);
			}
			else if ( aliasInvoke === 'discussion' && !querystring && !fragment ) {
				fandom_discussion(lang, msg, wiki, args.join(' '), body.query, reaction, spoiler);
			}
			else {
				if ( body.query.pages ) {
					var querypages = Object.values(body.query.pages);
					var querypage = querypages[0];
					if ( body.query.redirects && body.query.redirects[0].from.split(':')[0] === body.query.namespaces['-1']['*'] && body.query.specialpagealiases.filter( sp => ['Mypage','Mytalk','MyLanguage'].includes( sp.realname ) ).map( sp => sp.aliases[0] ).includes( body.query.redirects[0].from.split(':').slice(1).join(':').split('/')[0].replace( / /g, '_' ) ) ) {
						querypage.title = body.query.redirects[0].from;
						delete body.query.redirects[0].tofragment;
						delete querypage.missing;
						querypage.ns = -1;
						querypage.special = '';
					}
					if ( querypages.length !== 1 ) querypage = {
						title: title,
						invalidreason: 'The requested page title contains invalid characters: "|".',
						invalid: ''
					}
					
					var contribs = body.query.namespaces['-1']['*'] + ':' + body.query.specialpagealiases.find( sp => sp.realname === 'Contributions' ).aliases[0] + '/';
					if ( querypage.ns === 2 && ( !querypage.title.includes( '/' ) || /^[^:]+:(?:(?:\d{1,3}\.){3}\d{1,3}\/\d{2}|(?:[\dA-F]{1,4}:){7}[\dA-F]{1,4}\/\d{2,3})$/.test(querypage.title) ) ) {
						var userparts = querypage.title.split(':');
						querypage.noRedirect = noRedirect;
						fandom_user(lang, msg, userparts[0].toTitle() + ':', userparts.slice(1).join(':'), wiki, querystring, fragment, querypage, contribs.toTitle(), reaction, spoiler);
					}
					else if ( querypage.ns === -1 && querypage.title.startsWith( contribs ) && querypage.title.length > contribs.length ) {
						var username = querypage.title.split('/').slice(1).join('/');
						got.get( wiki + 'api.php?action=query&titles=User:' + encodeURIComponent( username ) + '&format=json', {
							responseType: 'json'
						} ).then( uresponse => {
							var ubody = uresponse.body;
							if ( uresponse.statusCode !== 200 || !ubody || !ubody.query ) {
								console.log( '- ' + uresponse.statusCode + ': Error while getting the user: ' + ( ubody && ubody.error && ubody.error.info ) );
								msg.sendChannelError( spoiler + '<' + wiki.toLink(contribs + username, querystring.toTitle(), fragment, body.query.general) + '>' + spoiler );
								
								if ( reaction ) reaction.removeEmoji();
							}
							else {
								querypage = Object.values(ubody.query.pages)[0];
								if ( querypage.ns === 2 ) {
									username = querypage.title.split(':').slice(1).join(':');
									querypage.title = contribs + username;
									delete querypage.missing;
									querypage.ns = -1;
									querypage.special = '';
									querypage.noRedirect = noRedirect;
									fandom_user(lang, msg, contribs.toTitle(), username, wiki, querystring, fragment, querypage, contribs.toTitle(), reaction, spoiler);
								}
								else {
									msg.reactEmoji('error');
									
									if ( reaction ) reaction.removeEmoji();
								}
							}
						}, error => {
							console.log( '- Error while getting the user: ' + error );
							msg.sendChannelError( spoiler + '<' + wiki.toLink(contribs + username, querystring.toTitle(), fragment, body.query.general) + '>' + spoiler );
							
							if ( reaction ) reaction.removeEmoji();
						} );
					}
					else if ( querypage.ns === 1201 && querypage.missing !== undefined ) {
						var thread = querypage.title.split(':');
						got.get( wiki + 'api.php?action=query&prop=revisions&rvprop=user&rvdir=newer&rvlimit=1&pageids=' + thread.slice(1).join(':') + '&format=json', {
							responseType: 'json'
						} ).then( thresponse => {
							var thbody = thresponse.body;
							if ( thresponse.statusCode !== 200 || !thbody || !thbody.query || !thbody.query.pages ) {
								console.log( '- ' + thresponse.statusCode + ': Error while getting the thread: ' + ( thbody && thbody.error && thbody.error.info ) );
								msg.sendChannelError( spoiler + '<' + wiki.toLink(querypage.title, querystring.toTitle(), fragment, body.query.general) + '>' + spoiler );
								
								if ( reaction ) reaction.removeEmoji();
							}
							else {
								querypage = thbody.query.pages[thread.slice(1).join(':')];
								if ( querypage.missing !== undefined ) {
									msg.reactEmoji('🤷');
									
									if ( reaction ) reaction.removeEmoji();
								}
								else {
									var pagelink = wiki.toLink(thread.join(':'), querystring.toTitle(), fragment, body.query.general);
									var embed = new Discord.MessageEmbed().setAuthor( body.query.general.sitename ).setTitle( thread.join(':').escapeFormatting() ).setURL( pagelink ).setFooter( querypage.revisions[0].user );
									got.get( wiki.toDescLink(querypage.title) ).then( descresponse => {
										var descbody = descresponse.body;
										if ( descresponse.statusCode !== 200 || !descbody ) {
											console.log( '- ' + descresponse.statusCode + ': Error while getting the description.' );
										} else {
											var thumbnail = wiki.toLink('Special:FilePath/Wiki-wordmark.png', '', '', body.query.general);
											var parser = new htmlparser.Parser( {
												onopentag: (tagname, attribs) => {
													if ( tagname === 'meta' && attribs.property === 'og:description' ) {
														var description = attribs.content.escapeFormatting();
														if ( description.length > 2000 ) description = description.substring(0, 2000) + '\u2026';
														embed.setDescription( description );
													}
													if ( tagname === 'meta' && attribs.property === 'og:image' ) {
														thumbnail = attribs.content;
													}
												}
											}, {decodeEntities:true} );
											parser.write( descbody );
											parser.end();
											embed.setThumbnail( thumbnail );
										}
									}, error => {
										console.log( '- Error while getting the description: ' + error );
									} ).finally( () => {
										msg.sendChannel( spoiler + '<' + pagelink + '>' + spoiler, {embed} );
										
										if ( reaction ) reaction.removeEmoji();
									} );
								}
							}
						}, error => {
							console.log( '- Error while getting the thread: ' + error );
							msg.sendChannelError( spoiler + '<' + wiki.toLink(querypage.title, querystring.toTitle(), fragment, body.query.general) + '>' + spoiler );
							
							if ( reaction ) reaction.removeEmoji();
						} );
					}
					else if ( ( querypage.missing !== undefined && querypage.known === undefined && !( noRedirect || querypage.categoryinfo ) ) || querypage.invalid !== undefined ) {
						got.get( wiki + 'api/v1/Search/List?minArticleQuality=0&namespaces=4,12,14,' + Object.values(body.query.namespaces).filter( ns => ns.content !== undefined ).map( ns => ns.id ).join(',') + '&limit=1&query=' + encodeURIComponent( title ) + '&format=json', {
							responseType: 'json'
						} ).then( wsresponse => {
							var wsbody = wsresponse.body;
							if ( wsresponse.statusCode !== 200 || !wsbody || wsbody.exception || !wsbody.total || !wsbody.items || !wsbody.items.length ) {
								if ( wsbody && ( !wsbody.total || ( wsbody.items && !wsbody.items.length ) || ( wsbody.exception && wsbody.exception.code === 404 ) ) ) msg.reactEmoji('🤷');
								else {
									console.log( '- ' + wsresponse.statusCode + ': Error while getting the search results: ' + ( wsbody && wsbody.exception && wsbody.exception.details ) );
									msg.sendChannelError( spoiler + '<' + wiki.toLink('Special:Search', 'search=' + title.toSearch(), '', body.query.general) + '>' + spoiler );
								}
								
								if ( reaction ) reaction.removeEmoji();
							}
							else {
								querypage = wsbody.items[0];
								if ( querypage.ns && !querypage.title.startsWith( body.query.namespaces[querypage.ns]['*'] + ':' ) ) {
									querypage.title = body.query.namespaces[querypage.ns]['*'] + ':' + querypage.title;
								}
								
								var text = '';
								var prefix = ( msg.channel.type === 'text' && patreons[msg.guild.id] || process.env.prefix );
								var linksuffix = ( querystring ? '?' + querystring : '' ) + ( fragment ? '#' + fragment : '' );
								if ( title.replace( /\-/g, ' ' ).toTitle().toLowerCase() === querypage.title.replace( /\-/g, ' ' ).toTitle().toLowerCase() ) {
									text = '';
								}
								else if ( wsbody.total === 1 ) {
									text = '\n' + lang.search.infopage.replaceSave( '%s', '`' + prefix + cmd + lang.search.page + ' ' + title + linksuffix + '`' );
								}
								else {
									text = '\n' + lang.search.infosearch.replaceSave( '%1$s', '`' + prefix + cmd + lang.search.page + ' ' + title + linksuffix + '`' ).replaceSave( '%2$s', '`' + prefix + cmd + lang.search.search + ' ' + title + linksuffix + '`' );
								}
								got.get( wiki + 'api.php?action=query&prop=imageinfo|categoryinfo&titles=' + encodeURIComponent( querypage.title ) + '&format=json', {
									responseType: 'json'
								} ).then( srresponse => {
									var srbody = srresponse.body;
									if ( srbody && srbody.warnings ) log_warn(srbody.warnings);
									if ( srresponse.statusCode !== 200 || !srbody || !srbody.query || !srbody.query.pages ) {
										console.log( '- ' + srresponse.statusCode + ': Error while getting the search results: ' + ( srbody && srbody.error && srbody.error.info ) );
										msg.sendChannelError( spoiler + '<' + wiki.toLink(querypage.title, querystring.toTitle(), fragment, body.query.general) + '>' + spoiler );
										
										if ( reaction ) reaction.removeEmoji();
									}
									else {
										querypage = Object.values(srbody.query.pages)[0];
										var pagelink = wiki.toLink(querypage.title, querystring.toTitle(), fragment, body.query.general);
										var embed = new Discord.MessageEmbed().setAuthor( body.query.general.sitename ).setTitle( querypage.title.escapeFormatting() ).setURL( pagelink );
										if ( querypage.imageinfo ) {
											var filename = querypage.title.replace( body.query.namespaces['6']['*'] + ':', '' );
											var pageimage = wiki.toLink('Special:FilePath/' + filename, 'v=' + Date.now(), '', body.query.general);
											if ( msg.showEmbed() && /\.(?:png|jpg|jpeg|gif)$/.test(querypage.title.toLowerCase()) ) embed.setImage( pageimage );
											else if ( msg.uploadFiles() ) embed.attachFiles( [{attachment:pageimage,name:( spoiler ? 'SPOILER ' : '' ) + filename}] );
										}
										if ( querypage.categoryinfo ) {
											var langCat = lang.search.category;
											var category = [langCat.content];
											if ( querypage.categoryinfo.size === 0 ) category.push(langCat.empty);
											if ( querypage.categoryinfo.pages > 0 ) {
												var pages = querypage.categoryinfo.pages;
												category.push(( langCat.pages[pages] || langCat.pages['*' + pages % 100] || langCat.pages['*' + pages % 10] || langCat.pages.default ).replaceSave( '%s', pages ));
											}
											if ( querypage.categoryinfo.files > 0 ) {
												var files = querypage.categoryinfo.files;
												category.push(( langCat.files[files] || langCat.files['*' + files % 100] || langCat.files['*' + files % 10] || langCat.files.default ).replaceSave( '%s', files ));
											}
											if ( querypage.categoryinfo.subcats > 0 ) {
												var subcats = querypage.categoryinfo.subcats;
												category.push(( langCat.subcats[subcats] || langCat.subcats['*' + subcats % 100] || langCat.subcats['*' + subcats % 10] || langCat.subcats.default ).replaceSave( '%s', subcats ));
											}
											if ( msg.showEmbed() ) embed.addField( category[0], category.slice(1).join('\n') );
											else text += '\n\n' + category.join('\n');
										}
										
										if ( querypage.title === body.query.general.mainpage && body.query.allmessages[0]['*'] ) {
											embed.setDescription( body.query.allmessages[0]['*'] );
											embed.setThumbnail( wiki.toLink('Special:FilePath/Wiki-wordmark.png', '', '', body.query.general) );
											
											msg.sendChannel( spoiler + '<' + pagelink + '>' + text + spoiler, {embed} );
											
											if ( reaction ) reaction.removeEmoji();
										}
										else got.get( wiki.toDescLink(querypage.title) ).then( descresponse => {
											var descbody = descresponse.body;
											if ( descresponse.statusCode !== 200 || !descbody ) {
												console.log( '- ' + descresponse.statusCode + ': Error while getting the description.' );
											} else {
												var thumbnail = wiki.toLink('Special:FilePath/Wiki-wordmark.png', '', '', body.query.general);
												var parser = new htmlparser.Parser( {
													onopentag: (tagname, attribs) => {
														if ( tagname === 'meta' && attribs.property === 'og:description' ) {
															var description = attribs.content.escapeFormatting();
															if ( description.length > 2000 ) description = description.substring(0, 2000) + '\u2026';
															embed.setDescription( description );
														}
														if ( tagname === 'meta' && attribs.property === 'og:image' && querypage.title !== body.query.general.mainpage ) {
															thumbnail = attribs.content;
														}
													}
												}, {decodeEntities:true} );
												parser.write( descbody );
												parser.end();
												if ( !querypage.imageinfo ) embed.setThumbnail( thumbnail );
											}
										}, error => {
											console.log( '- Error while getting the description: ' + error );
										} ).finally( () => {
											msg.sendChannel( spoiler + '<' + pagelink + '>' + text + spoiler, {embed} );
											
											if ( reaction ) reaction.removeEmoji();
										} );
									}
								}, error => {
									console.log( '- Error while getting the search results: ' + error );
									msg.sendChannelError( spoiler + '<' + wiki.toLink(querypage.title, querystring.toTitle(), fragment, body.query.general) + '>' + spoiler );
									
									if ( reaction ) reaction.removeEmoji();
								} );
							}
						}, error => {
							console.log( '- Error while getting the search results: ' + error );
							msg.sendChannelError( spoiler + '<' + wiki.toLink('Special:Search', 'search=' + title.toSearch(), '', body.query.general) + '>' + spoiler );
							
							if ( reaction ) reaction.removeEmoji();
						} );
					}
					else if ( querypage.ns === -1 ) {
						var pagelink = wiki.toLink(querypage.title, querystring.toTitle(), fragment, body.query.general);
						var embed =  new Discord.MessageEmbed().setAuthor( body.query.general.sitename ).setTitle( querypage.title.escapeFormatting() ).setURL( pagelink ).setThumbnail( wiki.toLink('Special:FilePath/Wiki-wordmark.png', '', '', body.query.general) );
						var specialpage = body.query.specialpagealiases.find( sp => body.query.namespaces['-1']['*'] + ':' + sp.aliases[0].replace( /\_/g, ' ' ) === querypage.title.split('/')[0] );
						specialpage = ( specialpage ? specialpage.realname : querypage.title.replace( body.query.namespaces['-1']['*'] + ':', '' ).split('/')[0] ).toLowerCase();
						special_page(lang, msg, querypage.title, specialpage, embed, wiki, reaction, spoiler);
					}
					else {
						var pagelink = wiki.toLink(querypage.title, querystring.toTitle(), ( fragment || ( body.query.redirects && body.query.redirects[0].tofragment || '' ) ), body.query.general);
						var text = '';
						var embed = new Discord.MessageEmbed().setAuthor( body.query.general.sitename ).setTitle( querypage.title.escapeFormatting() ).setURL( pagelink );
						if ( querypage.imageinfo ) {
							var filename = querypage.title.replace( body.query.namespaces['6']['*'] + ':', '' );
							var pageimage = wiki.toLink('Special:FilePath/' + filename, 'v=' + Date.now(), '', body.query.general);
							if ( msg.showEmbed() && /\.(?:png|jpg|jpeg|gif)$/.test(querypage.title.toLowerCase()) ) embed.setImage( pageimage );
							else if ( msg.uploadFiles() ) embed.attachFiles( [{attachment:pageimage,name:( spoiler ? 'SPOILER ' : '' ) + filename}] );
						}
						if ( querypage.categoryinfo ) {
							var langCat = lang.search.category;
							var category = [langCat.content];
							if ( querypage.categoryinfo.size === 0 ) category.push(langCat.empty);
							if ( querypage.categoryinfo.pages > 0 ) {
								var pages = querypage.categoryinfo.pages;
								category.push(( langCat.pages[pages] || langCat.pages['*' + pages % 100] || langCat.pages['*' + pages % 10]  || langCat.pages.default ).replaceSave( '%s', pages ));
							}
							if ( querypage.categoryinfo.files > 0 ) {
								var files = querypage.categoryinfo.files;
								category.push(( langCat.files[files] || langCat.files['*' + files % 100] || langCat.files['*' + files % 10]  || langCat.files.default ).replaceSave( '%s', files ));
							}
							if ( querypage.categoryinfo.subcats > 0 ) {
								var subcats = querypage.categoryinfo.subcats;
								category.push(( langCat.subcats[subcats] || langCat.subcats['*' + subcats % 100] || langCat.subcats['*' + subcats % 10]  || langCat.subcats.default ).replaceSave( '%s', subcats ));
							}
							if ( msg.showEmbed() ) embed.addField( category[0], category.slice(1).join('\n') );
							else text += '\n\n' + category.join('\n');
						}
						
						if ( querypage.title === body.query.general.mainpage && body.query.allmessages[0]['*'] ) {
							embed.setDescription( body.query.allmessages[0]['*'] );
							embed.setThumbnail( wiki.toLink('Special:FilePath/Wiki-wordmark.png', '', '', body.query.general) );
							
							msg.sendChannel( spoiler + '<' + pagelink + '>' + text + spoiler, {embed} );
							
							if ( reaction ) reaction.removeEmoji();
						}
						else got.get( wiki.toDescLink(querypage.title) ).then( descresponse => {
							var descbody = descresponse.body;
							if ( descresponse.statusCode !== 200 || !descbody ) {
								console.log( '- ' + descresponse.statusCode + ': Error while getting the description.' );
							} else {
								var thumbnail = wiki.toLink('Special:FilePath/Wiki-wordmark.png', '', '', body.query.general);
								var parser = new htmlparser.Parser( {
									onopentag: (tagname, attribs) => {
										if ( tagname === 'meta' && attribs.property === 'og:description' ) {
											var description = attribs.content.escapeFormatting();
											if ( description.length > 2000 ) description = description.substring(0, 2000) + '\u2026';
											embed.setDescription( description );
										}
										if ( tagname === 'meta' && attribs.property === 'og:image' && querypage.title !== body.query.general.mainpage ) {
											thumbnail = attribs.content;
										}
									}
								}, {decodeEntities:true} );
								parser.write( descbody );
								parser.end();
								if ( !querypage.imageinfo ) embed.setThumbnail( thumbnail );
							}
						}, error => {
							console.log( '- Error while getting the description: ' + error );
						} ).finally( () => {
							msg.sendChannel( spoiler + '<' + pagelink + '>' + text + spoiler, {embed} );
							
							if ( reaction ) reaction.removeEmoji();
						} );
					}
				}
				else if ( body.query.interwiki ) {
					var inter = body.query.interwiki[0];
					var intertitle = inter.title.substring(inter.iw.length + 1);
					var regex = inter.url.match( /^(?:https?:)?\/\/(([a-z\d-]{1,50})\.(?:fandom\.com|wikia\.org)(?:(?!\/wiki\/)\/([a-z-]{1,8}))?)(?:\/wiki\/|\/?$)/ );
					var maxselfcall = ( msg.channel.type === 'text' && msg.guild.id in patreons ? 10 : 5 );
					if ( regex !== null && selfcall < maxselfcall ) {
						if ( msg.channel.type !== 'text' || !pause[msg.guild.id] ) {
							var iwtitle = decodeURIComponent( inter.url.replace( regex[0], '' ) ).replace( /\_/g, ' ' ).replaceSave( intertitle.replace( /\_/g, ' ' ), intertitle );
							selfcall++;
							fandom_check_wiki(lang, msg, iwtitle, 'https://' + regex[1] + '/', ' ?' + ( regex[3] ? regex[3] + '.' : '' ) + regex[2] + ' ', reaction, spoiler, querystring, fragment, selfcall);
						} else {
							if ( reaction ) reaction.removeEmoji();
							console.log( '- Aborted, paused.' );
						}
					} else {
						regex = inter.url.match( /^(?:https?:)?\/\/([a-z\d-]{1,50})\.gamepedia\.com(?:\/|$)/ );
						if ( regex !== null && selfcall < maxselfcall ) {
							if ( msg.channel.type !== 'text' || !pause[msg.guild.id] ) {
								var iwtitle = decodeURIComponent( inter.url.replace( regex[0], '' ) ).replace( /\_/g, ' ' ).replaceSave( intertitle.replace( /\_/g, ' ' ), intertitle );
								selfcall++;
								gamepedia_check_wiki(lang, msg, iwtitle, 'https://' + regex[1] + '.gamepedia.com/', ' !' + regex[1] + ' ', reaction, spoiler, querystring, fragment, selfcall);
							} else {
								if ( reaction ) reaction.removeEmoji();
								console.log( '- Aborted, paused.' );
							}
						} else {
							regex = inter.url.match( /^(?:https?:)?\/\/([a-z\d-]{1,50}\.(?:wikipedia|mediawiki|wiktionary|wikimedia|wikibooks|wikisource|wikidata|wikiversity|wikiquote|wikinews|wikivoyage)\.org)(?:\/wiki\/|\/?$)/ );
							if ( regex !== null && selfcall < maxselfcall ) {
								if ( msg.channel.type !== 'text' || !pause[msg.guild.id] ) {
									var iwtitle = decodeURIComponent( inter.url.replace( regex[0], '' ) ).replace( /\_/g, ' ' ).replaceSave( intertitle.replace( /\_/g, ' ' ), intertitle );
									selfcall++;
									gamepedia_check_wiki(lang, msg, iwtitle, 'https://' + regex[1] + '/w/', cmd + inter.iw + ':', reaction, spoiler, querystring, fragment, selfcall);
								} else {
									if ( reaction ) reaction.removeEmoji();
									console.log( '- Aborted, paused.' );
								}
							} else {
								if ( fragment ) fragment = '#' + fragment.toSection();
								if ( inter.url.includes( '#' ) ) {
									if ( !fragment ) fragment = '#' + inter.url.split('#').slice(1).join('#');
									inter.url = inter.url.split('#')[0];
								}
								if ( querystring ) inter.url += ( inter.url.includes( '?' ) ? '&' : '?' ) + querystring.toTitle();
								msg.sendChannel( spoiler + ' ' + inter.url.replace( /@(here|everyone)/g, '%40$1' ) + fragment + ' ' + spoiler ).then( message => {
									if ( message && selfcall === maxselfcall ) message.reactEmoji('⚠️');
								} );
								if ( reaction ) reaction.removeEmoji();
							}
						}
					}
				}
				else if ( body.query.redirects ) {
					var pagelink = wiki.toLink(body.query.redirects[0].to, querystring.toTitle(), ( fragment || body.query.redirects[0].tofragment || '' ) );
					var embed = new Discord.MessageEmbed().setAuthor( body.query.general.sitename ).setTitle( body.query.redirects[0].to.escapeFormatting() ).setURL( pagelink ).setThumbnail( wiki.toLink('Special:FilePath/Wiki-wordmark.png', '', '', body.query.general) );
					
					msg.sendChannel( spoiler + '<' + pagelink + '>' + spoiler, {embed} );
					
					if ( reaction ) reaction.removeEmoji();;
				}
				else {
					var pagelink = wiki.toLink(body.query.general.mainpage, querystring.toTitle(), fragment, body.query.general);
					var embed = new Discord.MessageEmbed().setAuthor( body.query.general.sitename ).setTitle( body.query.general.mainpage.escapeFormatting() ).setURL( pagelink ).setThumbnail( wiki.toLink('Special:FilePath/Wiki-wordmark.png', '', '', body.query.general) );
					
					if ( body.query.allmessages[0]['*'] ) {
						embed.setDescription( body.query.allmessages[0]['*'] );
						
						msg.sendChannel( spoiler + '<' + pagelink + '>' + spoiler, {embed} );
						
						if ( reaction ) reaction.removeEmoji();
					}
					else got.get( wiki.toDescLink(body.query.general.mainpage) ).then( descresponse => {
						var descbody = descresponse.body;
						if ( descresponse.statusCode !== 200 || !descbody ) {
							console.log( '- ' + descresponse.statusCode + ': Error while getting the description.' );
						} else {
							var parser = new htmlparser.Parser( {
								onopentag: (tagname, attribs) => {
									if ( tagname === 'meta' && attribs.property === 'og:description' ) {
										var description = attribs.content.escapeFormatting();
										if ( description.length > 2000 ) description = description.substring(0, 2000) + '\u2026';
										embed.setDescription( description );
									}
								}
							}, {decodeEntities:true} );
							parser.write( descbody );
							parser.end();
						}
					}, error => {
						console.log( '- Error while getting the description: ' + error );
					} ).finally( () => {
						msg.sendChannel( spoiler + '<' + pagelink + '>' + spoiler, {embed} );
						
						if ( reaction ) reaction.removeEmoji();
					} );
				}
			}
		}, error => {
			if ( wiki.noWiki(error.message) ) {
				console.log( '- This wiki doesn\'t exist!' );
				msg.reactEmoji('nowiki');
			}
			else {
				console.log( '- Error while getting the search results: ' + error );
				msg.sendChannelError( spoiler + '<' + wiki.toLink(( querystring || fragment || !title ? title : 'Special:Search' ), ( querystring || fragment || !title ? querystring.toTitle() : 'search=' + title.toSearch() ), fragment) + '>' + spoiler );
			}
			
			if ( reaction ) reaction.removeEmoji();
		} );
	}
}

function special_page(lang, msg, title, specialpage, embed, wiki, reaction, spoiler) {
	var overwrites = {
		randompage: (lang, msg, args, embed, wiki, reaction, spoiler) => ( wiki.isFandom() ? fandom_random : gamepedia_random )(lang, msg, wiki, reaction, spoiler),
		diff: (lang, msg, args, embed, wiki, reaction, spoiler) => ( wiki.isFandom() ? fandom_diff : gamepedia_diff )(lang, msg, args, wiki, reaction, spoiler, embed),
		statistics: (lang, msg, args, embed, wiki, reaction, spoiler) => ( wiki.isFandom() ? fandom_overview : gamepedia_overview )(lang, msg, wiki, reaction, spoiler)
	}
	if ( specialpage in overwrites ) {
		var args = title.split('/').slice(1,3);
		overwrites[specialpage](lang, msg, args, embed, wiki, reaction, spoiler);
		return;
	}
	var queryfunctions = {
		title: query => query.querypage.results.map( result => {
			return '[' + result.title.escapeFormatting() + '](' + wiki.toLink(result.title, '', '', query.general, true) + ')';
		} ).join('\n'),
		times: query => query.querypage.results.map( result => {
			return result.value + '× [' + result.title.escapeFormatting() + '](' + wiki.toLink(result.title, '', '', query.general, true) + ')';
		} ).join('\n'),
		size: query => query.querypage.results.map( result => {
			return result.value + ' bytes: [' + result.title.escapeFormatting() + '](' + wiki.toLink(result.title, '', '', query.general, true) + ')';
		} ).join('\n'),
		redirect: query => query.querypage.results.map( result => {
			return '[' + result.title.replace( / /g, '_' ).escapeFormatting() + '](' + wiki.toLink(result.title, 'redirect=no', '', query.general, true) + ')' + ( result.databaseResult && result.databaseResult.rd_title ? ' → ' + result.databaseResult.rd_title.escapeFormatting() : '' );
		} ).join('\n'),
		doubleredirect: query => query.querypage.results.map( result => {
			return '[' + result.title.replace( / /g, '_' ).escapeFormatting() + '](' + wiki.toLink(result.title, 'redirect=no', '', query.general, true) + ')' + ( result.databaseResult && result.databaseResult.b_title && result.databaseResult.c_title ? ' → ' + result.databaseResult.b_title.escapeFormatting() + ' → ' + result.databaseResult.c_title.escapeFormatting() : '' );
		} ).join('\n'),
		timestamp: query => query.querypage.results.map( result => {
			return new Date(result.timestamp).toLocaleString(lang.dateformat, timeoptions).escapeFormatting() + ': [' + result.title.escapeFormatting() + '](' + wiki.toLink(result.title, '', '', query.general, true) + ')';
		} ).join('\n'),
		media: query => query.querypage.results.map( result => {
			var ms = result.title.split(';');
			return '**' + ms[1] + '**: ' + ms[2] + ' files (' + ms[3] + ' bytes)';
		} ).join('\n'),
		category: query => query.querypage.results.map( result => {
			return result.value + '× [' + result.title.escapeFormatting() + '](' + wiki.toLink('Category:' + result.title, '', '', query.general, true) + ')';
		} ).join('\n'),
		gadget: query => query.querypage.results.map( result => {
			result.title = result.title.replace( /^(?:.*:)?gadget-/, '' );
			return '**' + result.title.escapeFormatting() + '**: ' + result.value + ' users (' + result.ns + ' active)';
		} ).join('\n'),
		recentchanges: query => query.recentchanges.map( result => {
			return '[' + result.title.escapeFormatting() + '](' + wiki.toLink(result.title, ( result.type === 'edit' ? 'diff=' + result.revid + '&oldid=' + result.old_revid : '' ), '', query.general, true) + ')';
		} ).join('\n')
	}
	var querypages = {
		ancientpages: ['&list=querypage&qplimit=10&qppage=Ancientpages', queryfunctions.timestamp],
		brokenredirects: ['&list=querypage&qplimit=10&qppage=BrokenRedirects', queryfunctions.redirect],
		deadendpages: ['&list=querypage&qplimit=10&qppage=Deadendpages', queryfunctions.title],
		disambiguations: ['&list=querypage&qplimit=10&qppage=Disambiguations', queryfunctions.title],
		doubleredirects: ['&list=querypage&qplimit=10&qppage=DoubleRedirects', queryfunctions.doubleredirect],
		listduplicatedfiles: ['&list=querypage&qplimit=10&qppage=ListDuplicatedFiles', queryfunctions.times],
		listredirects: ['&list=querypage&qplimit=10&qppage=Listredirects', queryfunctions.redirect],
		lonelypages: ['&list=querypage&qplimit=10&qppage=Lonelypages', queryfunctions.title],
		longpages: ['&list=querypage&qplimit=10&qppage=Longpages', queryfunctions.size],
		mediastatistics: ['&list=querypage&qplimit=10&qppage=MediaStatistics', queryfunctions.media],
		mostcategories: ['&list=querypage&qplimit=10&qppage=Mostcategories', queryfunctions.times],
		mostimages: ['&list=querypage&qplimit=10&qppage=Mostimages', queryfunctions.times],
		mostinterwikis: ['&list=querypage&qplimit=10&qppage=Mostinterwikis', queryfunctions.times],
		mostlinkedcategories: ['&list=querypage&qplimit=10&qppage=Mostlinkedcategories', queryfunctions.times],
		mostlinkedtemplates: ['&list=querypage&qplimit=10&qppage=Mostlinkedtemplates', queryfunctions.times],
		mostlinked: ['&list=querypage&qplimit=10&qppage=Mostlinked', queryfunctions.times],
		mostrevisions: ['&list=querypage&qplimit=10&qppage=Mostrevisions', queryfunctions.times],
		fewestrevisions: ['&list=querypage&qplimit=10&qppage=Fewestrevisions', queryfunctions.times],
		shortpages: ['&list=querypage&qplimit=10&qppage=Shortpages', queryfunctions.size],
		uncategorizedcategories: ['&list=querypage&qplimit=10&qppage=Uncategorizedcategories', queryfunctions.title],
		uncategorizedpages: ['&list=querypage&qplimit=10&qppage=Uncategorizedpages', queryfunctions.title],
		uncategorizedimages: ['&list=querypage&qplimit=10&qppage=Uncategorizedimages', queryfunctions.title],
		uncategorizedtemplates: ['&list=querypage&qplimit=10&qppage=Uncategorizedtemplates', queryfunctions.title],
		unusedcategories: ['&list=querypage&qplimit=10&qppage=Unusedcategories', queryfunctions.title],
		unusedimages: ['&list=querypage&qplimit=10&qppage=Unusedimages', queryfunctions.title],
		wantedcategories: ['&list=querypage&qplimit=10&qppage=Wantedcategories', queryfunctions.times],
		wantedfiles: ['&list=querypage&qplimit=10&qppage=Wantedfiles', queryfunctions.times],
		wantedpages: ['&list=querypage&qplimit=10&qppage=Wantedpages', queryfunctions.times],
		wantedtemplates: ['&list=querypage&qplimit=10&qppage=Wantedtemplates', queryfunctions.times],
		unwatchedpages: ['&list=querypage&qplimit=10&qppage=Unwatchedpages', queryfunctions.title],
		unusedtemplates: ['&list=querypage&qplimit=10&qppage=Unusedtemplates', queryfunctions.title],
		withoutinterwiki: ['&list=querypage&qplimit=10&qppage=Withoutinterwiki', queryfunctions.title],
		mostpopularcategories: ['&list=querypage&qplimit=10&qppage=Mostpopularcategories', queryfunctions.category],
		mostimagesincontent: ['&list=querypage&qplimit=10&qppage=MostLinkedFilesInContent', queryfunctions.times],
		unusedvideos: ['&list=querypage&qplimit=10&qppage=UnusedVideos', queryfunctions.title],
		withoutimages: ['&list=querypage&qplimit=10&qppage=Withoutimages', queryfunctions.title],
		nonportableinfoboxes: ['&list=querypage&qplimit=10&qppage=Nonportableinfoboxes', queryfunctions.title],
		popularpages: ['&list=querypage&qplimit=10&qppage=Popularpages', queryfunctions.title],
		pageswithoutinfobox: ['&list=querypage&qplimit=10&qppage=Pageswithoutinfobox', queryfunctions.title],
		templateswithouttype: ['&list=querypage&qplimit=10&qppage=Templateswithouttype', queryfunctions.title],
		allinfoboxes: ['&list=querypage&qplimit=10&qppage=AllInfoboxes', queryfunctions.title],
		gadgetusage: ['&list=querypage&qplimit=10&qppage=GadgetUsage', queryfunctions.gadget],
		recentchanges: ['&list=recentchanges&rctype=edit|new|log&rclimit=10', queryfunctions.recentchanges]
	}
	got.get( wiki + 'api.php?action=query&meta=siteinfo|allmessages&siprop=general&amenableparser=true&amtitle=' + encodeURIComponent( title ) + '&ammessages=' + encodeURIComponent( specialpage ) + '-summary' + ( specialpage in querypages ? querypages[specialpage][0] : '' ) + '&format=json', {
		responseType: 'json'
	} ).then( response => {
		var body = response.body;
		if ( body && body.warnings ) log_warn(body.warnings);
		if ( response.statusCode !== 200 || !body ) {
			console.log( '- ' + response.statusCode + ': Error while getting the special page: ' + ( body && body.error && body.error.info ) );
		}
		else {
			if ( body.query.allmessages[0]['*'] ) {
				var description = body.query.allmessages[0]['*'].toPlaintext();
				if ( description.length > 2000 ) description = description.substring(0, 2000) + '\u2026';
				embed.setDescription( description );
			}
			if ( msg.channel.type === 'text' && msg.guild.id in patreons && specialpage in querypages ) {
				var text = Discord.Util.splitMessage( querypages[specialpage][1](body.query), {maxLength:1000} )[0];
				embed.addField( lang.search.special, ( text || lang.search.empty ) );
			}
		}
	}, error => {
		console.log( '- Error while getting the special page: ' + error );
	} ).finally( () => {
		msg.sendChannel( spoiler + '<' + embed.url + '>' + spoiler, {embed} );
		
		if ( reaction ) reaction.removeEmoji();
	} );
}

function gamepedia_search(lang, msg, searchterm, wiki, query, reaction, spoiler) {
	if ( searchterm.length > 250 ) {
		searchterm = searchterm.substring(0, 250);
		msg.reactEmoji('⚠️');
	}
	var pagelink = wiki.toLink('Special:Search', 'search=' + searchterm.toSearch() + '&fulltext=1', '', query.general);
	var embed = new Discord.MessageEmbed().setAuthor( query.general.sitename ).setTitle( '`' + searchterm + '`' ).setURL( pagelink );
	if ( !searchterm.trim() ) {
		pagelink = wiki.toLink('Special:Search', '', '', query.general);
		embed.setTitle( 'Special:Search' ).setURL( pagelink );
	}
	var description = [];
	got.get( wiki + 'api.php?action=query&titles=Special:Search&list=search&srinfo=totalhits&srprop=redirecttitle|sectiontitle&srnamespace=4|12|14|' + Object.values(query.namespaces).filter( ns => ns.content !== undefined ).map( ns => ns.id ).join('|') + '&srlimit=10&srsearch=' + encodeURIComponent( ( searchterm || ' ' ) ) + '&format=json', {
		responseType: 'json'
	} ).then( response => {
		var body = response.body;
		if ( body && body.warnings ) log_warn(body.warnings);
		if ( response.statusCode !== 200 || !body || !body.query || !body.query.search || body.batchcomplete === undefined ) {
			return console.log( '- ' + response.statusCode + ': Error while getting the search results: ' + ( body && body.error && body.error.info ) );
		}
		if ( body.query.pages && body.query.pages['-1'] && body.query.pages['-1'].title ) {
			if ( searchterm.trim() ) {
				pagelink = wiki.toLink(body.query.pages['-1'].title, 'search=' + searchterm.toSearch() + '&fulltext=1', '', query.general);
				embed.setURL( pagelink );
			}
			else {
				pagelink = wiki.toLink(body.query.pages['-1'].title, '', '', query.general);
				embed.setTitle( body.query.pages['-1'].title ).setURL( pagelink );
			}
		}
		if ( searchterm.trim() ) {
			body.query.search.forEach( result => {
				description.push( '• [' + result.title + '](' + wiki.toLink(result.title, '', '', query.general, true) + ')' + ( result.sectiontitle ? ' § [' + result.sectiontitle + '](' + wiki.toLink(result.title, '', result.sectiontitle, query.general, true) + ')' : '' ) + ( result.redirecttitle ? ' (⤷ [' + result.redirecttitle + '](' + wiki.toLink(result.redirecttitle, '', '', query.general, true) + '))' : '' ) );
			} );
			embed.setFooter( ( lang.search.results[body.query.searchinfo.totalhits] || lang.search.results['*' + body.query.searchinfo.totalhits % 100] || lang.search.results['*' + body.query.searchinfo.totalhits % 10]  || lang.search.results.default ).replaceSave( '%s', body.query.searchinfo.totalhits ) );
		}
	}, error => {
		console.log( '- Error while getting the search results.' + error );
	} ).finally( () => {
		embed.setDescription( Discord.Util.splitMessage( description.join('\n') )[0] );
		msg.sendChannel( spoiler + '<' + pagelink + '>' + spoiler, {embed} );
		
		if ( reaction ) reaction.removeEmoji();
	} );
}

function fandom_search(lang, msg, searchterm, wiki, query, reaction, spoiler) {
	if ( searchterm.length > 250 ) {
		searchterm = searchterm.substring(0, 250);
		msg.reactEmoji('⚠️');
	}
	var pagelink = wiki.toLink('Special:Search', 'search=' + searchterm.toSearch(), '', query.general);
	var embed = new Discord.MessageEmbed().setAuthor( query.general.sitename ).setTitle( '`' + searchterm + '`' ).setURL( pagelink );
	if ( !searchterm.trim() ) {
		pagelink = wiki.toLink('Special:Search', '', '', query.general);
		embed.setTitle( 'Special:Search' ).setURL( pagelink );
		msg.sendChannel( spoiler + '<' + pagelink + '>' + spoiler, {embed} );
		
		if ( reaction ) reaction.removeEmoji();
		return;
	}
	var description = [];
	got.get( wiki + 'api/v1/Search/List?minArticleQuality=0&namespaces=4,12,14,' + Object.values(query.namespaces).filter( ns => ns.content !== undefined ).map( ns => ns.id ).join(',') + '&limit=10&query=' + encodeURIComponent( searchterm ) + '&format=json', {
		responseType: 'json'
	} ).then( response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body || body.exception || !body.items ) {
			if ( !( body && body.exception && body.exception.code === 404 ) ) {
				console.log( '- ' + response.statusCode + ': Error while getting the search results: ' + ( body && body.exception && body.exception.details ) );
			}
			return;
		}
		body.items.forEach( result => {
			description.push( '• [' + result.title + '](' + wiki.toLink(result.title, '', '', query.general, true) + ')' );
		} );
		embed.setFooter( ( lang.search.results[body.total] || lang.search.results['*' + body.total % 100] || lang.search.results['*' + body.total % 10]  || lang.search.results.default ).replaceSave( '%s', body.total ) );
	}, error => {
		console.log( '- Error while getting the search results.' + error );
	} ).finally( () => {
		embed.setDescription( Discord.Util.splitMessage( description.join('\n') )[0] );
		msg.sendChannel( spoiler + '<' + pagelink + '>' + spoiler, {embed} );
		
		if ( reaction ) reaction.removeEmoji();
	} );
}

function cmd_verification(lang, msg, args, line, wiki) {
	if ( !msg.isAdmin() ) {
		if ( msg.channel.type === 'text' && !pause[msg.guild.id] ) cmd_verify(lang, msg, args, line, wiki);
		else msg.reactEmoji('❌');
		return;
	}
	if ( !msg.guild.me.permissions.has('MANAGE_ROLES') ) {
		console.log( msg.guild.id + ': Missing permissions - MANAGE_ROLES' );
		return msg.replyMsg( lang.missingperm + ' `MANAGE_ROLES`' );
	}
	
	db.all( 'SELECT configid, channel, role, editcount, usergroup, accountage, rename FROM verification WHERE guild = ? ORDER BY configid ASC', [msg.guild.id], (error, rows) => {
		if ( error || !rows ) {
			console.log( '- Error while getting the verifications: ' + error );
			msg.reactEmoji('error', true);
			return error;
		}
		
		var prefix = ( patreons[msg.guild.id] || process.env.prefix );
		if ( args[0] && args[0].toLowerCase() === 'add' ) {
			var limit = ( msg.guild.id in patreons ? 15 : 10 );
			if ( rows.length >= limit ) return msg.replyMsg( lang.verification.max_entries, {}, true );
			var roles = args.slice(1).join(' ').split('|').map( role => role.replace( /^\s*<?\s*(.*?)\s*>?\s*$/, '$1' ) ).filter( role => role.length );
			if ( !roles.length ) return msg.replyMsg( lang.verification.no_role + '\n`' + prefix + ' verification add ' + lang.verification.new_role + '`', {}, true );
			if ( roles.length > 10 ) return msg.replyMsg( lang.verification.role_max, {}, true );
			roles = roles.map( role => {
				var new_role = '';
				if ( /^\d+$/.test(role) ) new_role = msg.guild.roles.cache.get(role);
				if ( !new_role ) new_role = msg.guild.roles.cache.find( gc => gc.name === role.replace( /^@/, '' ) );
				if ( !new_role ) new_role = msg.guild.roles.cache.find( gc => gc.name.toLowerCase() === role.toLowerCase().replace( /^@/, '' ) );
				return new_role;
			} );
			if ( roles.some( role => !role ) ) return msg.replyMsg( lang.verification.role_missing, {}, true );
			if ( roles.some( role => role.managed ) ) return msg.replyMsg( lang.verification.role_managed, {}, true );
			roles = roles.map( role => role.id ).join('|');
			var new_configid = 1;
			for ( let i of rows.map( row => row.configid ) ) {
				if ( new_configid === i ) new_configid++;
				else break;
			}
			return db.run( 'INSERT INTO verification(guild, configid, channel, role) VALUES(?, ?, ?, ?)', [msg.guild.id, new_configid, '|' + msg.channel.id + '|', roles], function (dberror) {
				if ( dberror ) {
					console.log( '- Error while adding the verification: ' + dberror );
					msg.replyMsg( lang.verification.save_failed, {}, true );
					return dberror;
				}
				console.log( '- Verification successfully added.' );
				msg.replyMsg( lang.verification.added + formatVerification(false, false, {configid: new_configid, role: roles}), {}, true );
			} );
		}
		if ( !rows.some( row => row.configid.toString() === args[0] ) ) {
			if ( args.length ) {
				if ( !pause[msg.guild.id] ) cmd_verify(lang, msg, args, line, wiki);
				return;
			}
			var text = '';
			if ( rows.length ) text += lang.verification.current + rows.map( row => formatVerification(false, true, row) ).join('');
			else text += lang.verification.missing;
			text += '\n\n' + lang.verification.add_more + '\n`' + prefix + ' verification add ' + lang.verification.new_role + '`';
			return msg.sendChannel( '<@' + msg.author.id + '>, ' + text, {split:true}, true );
		}
		var row = rows.find( row => row.configid.toString() === args[0] );
		if ( args[1] ) args[1] = args[1].toLowerCase();
		if ( args[1] === 'delete' && !args.slice(2).join('') ) {
			return db.run( 'DELETE FROM verification WHERE guild = ? AND configid = ?', [msg.guild.id, row.configid], function (dberror) {
				if ( dberror ) {
					console.log( '- Error while removing the verification: ' + dberror );
					msg.replyMsg( lang.verification.save_failed, {}, true );
					return dberror;
				}
				console.log( '- Verification successfully removed.' );
				msg.replyMsg( lang.verification.deleted, {}, true );
			} );
		}
		if ( args[1] === 'rename' && !args.slice(2).join('') ) {
			if ( !row.rename && !msg.guild.me.permissions.has('MANAGE_NICKNAMES') ) {
				console.log( msg.guild.id + ': Missing permissions - MANAGE_NICKNAMES' );
				return msg.replyMsg( lang.missingperm + ' `MANAGE_NICKNAMES`' );
			}
			return db.run( 'UPDATE verification SET rename = ? WHERE guild = ? AND configid = ?', [( row.rename ? 0 : 1 ), msg.guild.id, row.configid], function (dberror) {
				if ( dberror ) {
					console.log( '- Error while updating the verification: ' + dberror );
					msg.replyMsg( lang.verification.save_failed, {}, true );
					return dberror;
				}
				console.log( '- Verification successfully updated.' );
				row.rename = ( row.rename ? 0 : 1 );
				msg.sendChannel( '<@' + msg.author.id + '>, ' + lang.verification.updated + formatVerification(), {split:true}, true );
			} );
		}
		if ( args[2] ) {
			args[2] = args.slice(2).join(' ').replace( /^\s*<?\s*(.*?)\s*>?\s*$/, '$1' );
			if ( args[1] === 'channel' ) {
				var channels = args[2].replace( /\s*>?\s*\|\s*<?\s*/g, '|' ).split('|').filter( channel => channel.length );
				if ( channels.length > 10 ) return msg.replyMsg( lang.verification.channel_max, {}, true );
				channels = channels.map( channel => {
					var new_channel = '';
					if ( /^\d+$/.test(channel) ) new_channel = msg.guild.channels.cache.filter( tc => tc.type === 'text' ).get(channel);
					if ( !new_channel ) new_channel = msg.guild.channels.cache.filter( gc => gc.type === 'text' ).find( gc => gc.name === channel.replace( /^#/, '' ) );
					if ( !new_channel ) new_channel = msg.guild.channels.cache.filter( gc => gc.type === 'text' ).find( gc => gc.name.toLowerCase() === channel.toLowerCase().replace( /^#/, '' ) );
					return new_channel;
				} );
				if ( channels.some( channel => !channel ) ) return msg.replyMsg( lang.verification.channel_missing, {}, true );
				channels = channels.map( channel => channel.id ).join('|');
				if ( channels.length ) return db.run( 'UPDATE verification SET channel = ? WHERE guild = ? AND configid = ?', ['|' + channels + '|', msg.guild.id, row.configid], function (dberror) {
					if ( dberror ) {
						console.log( '- Error while updating the verification: ' + dberror );
						msg.replyMsg( lang.verification.save_failed, {}, true );
						return dberror;
					}
					console.log( '- Verification successfully updated.' );
					row.channel = '|' + channels + '|';
					msg.sendChannel( '<@' + msg.author.id + '>, ' + lang.verification.updated + formatVerification(), {split:true}, true );
				} );
			}
			if ( args[1] === 'role' ) {
				var roles = args[2].replace( /\s*>?\s*\|\s*<?\s*/g, '|' ).split('|').filter( role => role.length );
				if ( roles.length > 10 ) return msg.replyMsg( lang.verification.role_max, {}, true );
				roles = roles.map( role => {
					var new_role = '';
					if ( /^\d+$/.test(role) ) new_role = msg.guild.roles.cache.get(role);
					if ( !new_role ) new_role = msg.guild.roles.cache.find( gc => gc.name === role.replace( /^@/, '' ) );
					if ( !new_role ) new_role = msg.guild.roles.cache.find( gc => gc.name.toLowerCase() === role.toLowerCase().replace( /^@/, '' ) );
					return new_role;
				} );
				if ( roles.some( role => !role ) ) return msg.replyMsg( lang.verification.role_missing, {}, true );
				if ( roles.some( role => role.managed ) ) return msg.replyMsg( lang.verification.role_managed, {}, true );
				roles = roles.map( role => role.id ).join('|');
				if ( roles.length ) return db.run( 'UPDATE verification SET role = ? WHERE guild = ? AND configid = ?', [roles, msg.guild.id, row.configid], function (dberror) {
					if ( dberror ) {
						console.log( '- Error while updating the verification: ' + dberror );
						msg.replyMsg( lang.verification.save_failed, {}, true );
						return dberror;
					}
					console.log( '- Verification successfully updated.' );
					row.role = roles;
					msg.sendChannel( '<@' + msg.author.id + '>, ' + lang.verification.updated + formatVerification(), {split:true}, true );
				} );
			}
			if ( ( args[1] === 'editcount' || args[1] === 'accountage' ) && /^\d+$/.test(args[2]) ) {
				args[2] = parseInt(args[2], 10);
				if ( args[2] > 1000000 ) return msg.replyMsg( lang.verification.value_too_high, {}, true );
				return db.run( 'UPDATE verification SET ' + args[1] + ' = ? WHERE guild = ? AND configid = ?', [args[2], msg.guild.id, row.configid], function (dberror) {
					if ( dberror ) {
						console.log( '- Error while updating the verification: ' + dberror );
						msg.replyMsg( lang.verification.save_failed, {}, true );
						return dberror;
					}
					console.log( '- Verification successfully updated.' );
					row[args[1]] = args[2];
					msg.sendChannel( '<@' + msg.author.id + '>, ' + lang.verification.updated + formatVerification(), {split:true}, true );
				} );
			}
			if ( args[1] === 'usergroup' ) {
				var usergroups = args[2].replace( /\s*>?\s*\|\s*<?\s*/g, '|' ).replace( / /g, '_' ).toLowerCase().split('|').filter( usergroup => usergroup.length );
				var and_or = '';
				if ( /^\s*AND\s*\|/.test(args[2]) ) {
					usergroups = usergroups.slice(1);
					and_or = 'AND|';
				}
				if ( usergroups.length > 10 ) return msg.replyMsg( lang.verification.usergroup_max, {}, true );
				if ( usergroups.some( usergroup => usergroup.length > 100 ) ) return msg.replyMsg( lang.verification.usergroup_too_long, {}, true );
				if ( usergroups.length ) return msg.reactEmoji('⏳').then( reaction => got.get( wiki + 'api.php?action=query&meta=allmessages&amprefix=group-&amincludelocal=true&amenableparser=true&format=json', {
					responseType: 'json'
				} ).then( response => {
					var body = response.body;
					if ( body && body.warnings ) log_warn(body.warnings);
					if ( response.statusCode !== 200 || !body || !body.query || !body.query.allmessages ) {
						if ( wiki.noWiki(response.url) || response.statusCode === 410 ) console.log( '- This wiki doesn\'t exist!' );
						else console.log( '- ' + response.statusCode + ': Error while getting the usergroups: ' + ( body && body.error && body.error.info ) );
					}
					var groups = body.query.allmessages.filter( group => !/\.(?:css|js)$/.test(group.name) && group.name !== 'group-all' ).map( group => {
						return {
							name: group.name.replace( /^group-/, '' ).replace( /-member$/, '' ),
							content: group['*'].replace( / /g, '_' ).toLowerCase()
						};
					} );
					usergroups = usergroups.map( usergroup => {
						if ( groups.some( group => group.name === usergroup ) ) return usergroup;
						if ( groups.some( group => group.content === usergroup ) ) return groups.find( group => group.content === usergroup ).name;
						if ( /^admins?$/.test(usergroup) ) return 'sysop'
						return usergroup;
					} );
				}, error => {
					console.log( '- Error while getting the usergroups: ' + error );
				} ).finally( () => {
					usergroups = usergroups.join('|');
					db.run( 'UPDATE verification SET usergroup = ? WHERE guild = ? AND configid = ?', [and_or + usergroups, msg.guild.id, row.configid], function (dberror) {
						if ( dberror ) {
							console.log( '- Error while updating the verification: ' + dberror );
							msg.replyMsg( lang.verification.save_failed, {}, true );
							return dberror;
						}
						console.log( '- Verification successfully updated.' );
						row.usergroup = and_or + usergroups;
						msg.sendChannel( '<@' + msg.author.id + '>, ' + lang.verification.updated + formatVerification(), {split:true}, true );
						
						if ( reaction ) reaction.removeEmoji();
					} );
				} ) );
			}
		}
		return msg.sendChannel( '<@' + msg.author.id + '>, ' + lang.verification.current_selected.replace( '%1', row.configid ) + formatVerification(true) +'\n\n' + lang.verification.delete_current + '\n`' + prefix + ' verification ' + row.configid + ' delete`', {split:true}, true );
		
		function formatVerification(showCommands, hideNotice, {
			configid,
			channel = '|' + msg.channel.id + '|',
			role,
			editcount = 0,
			usergroup = 'user',
			accountage = 0,
			rename = 0
		} = row) {
			var verification_text = '\n\n`' + prefix + ' verification ' + configid + '`';
			verification_text += '\n' + lang.verification.channel + ' <#' + channel.split('|').filter( channel => channel.length ).join('>, <#') + '>';
			if ( showCommands ) verification_text += '\n`' + prefix + ' verification ' + row.configid + ' channel ' + lang.verification.new_channel + '`\n';
			verification_text += '\n' + lang.verification.role + ' <@&' + role.split('|').join('>, <@&') + '>';
			if ( showCommands ) verification_text += '\n`' + prefix + ' verification ' + row.configid + ' role ' + lang.verification.new_role + '`\n';
			verification_text += '\n' + lang.verification.editcount + ' `' + editcount + '`';
			if ( showCommands ) verification_text += '\n`' + prefix + ' verification ' + row.configid + ' editcount ' + lang.verification.new_editcount + '`\n';
			verification_text += '\n' + lang.verification.usergroup + ' `' + ( usergroup.startsWith( 'AND|' ) ? usergroup.split('|').slice(1).join('` ' + lang.verification.and + ' `') : usergroup.split('|').join('` ' + lang.verification.or + ' `') ) + '`';
			if ( showCommands ) verification_text += '\n`' + prefix + ' verification ' + row.configid + ' usergroup ' + lang.verification.new_usergroup + '`\n';
			verification_text += '\n' + lang.verification.accountage + ' `' + accountage + '` ' + lang.verification.indays;
			if ( showCommands ) verification_text += '\n`' + prefix + ' verification ' + row.configid + ' accountage ' + lang.verification.new_accountage + '`\n';
			verification_text += '\n' + lang.verification.rename + ' *`' + ( rename ? lang.verification.enabled : lang.verification.disabled ) + '`*';
			if ( showCommands ) verification_text += ' ' + lang.verification.toggle + '\n`' + prefix + ' verification ' + row.configid + ' rename`\n';
			if ( !hideNotice && rename && !msg.guild.me.permissions.has('MANAGE_NICKNAMES') ) {
				verification_text += '\n\n' + lang.verification.rename_no_permission.replaceSave( '%s', msg.guild.me.toString() );
			}
			if ( !hideNotice && role.split('|').some( role => msg.guild.me.roles.highest.comparePositionTo(role) <= 0 ) ) {
				verification_text += '\n';
				role.split('|').forEach( role => {
					if ( msg.guild.me.roles.highest.comparePositionTo(role) <= 0 ) {
						verification_text += '\n' + lang.verification.role_too_high.replaceSave( '%1$s', '<@&' + role + '>' ).replaceSave( '%2$s', msg.guild.me.toString() );
					}
				} );
			}
			return verification_text;
		}
	} );
}

function cmd_verify(lang, msg, args, line, wiki) {
	if ( msg.channel.type !== 'text' ) return cmd_link(lang, msg, line.split(' ').slice(1).join(' '), wiki);
	if ( !msg.guild.me.permissions.has('MANAGE_ROLES') ) {
		if ( msg.isAdmin() || msg.isOwner() ) {
			console.log( msg.guild.id + ': Missing permissions - MANAGE_ROLES' );
			msg.replyMsg( lang.missingperm + ' `MANAGE_ROLES`' );
		} else cmd_link(lang, msg, line.split(' ').slice(1).join(' '), wiki);
		return
	}
	
	var username = args.join(' ').replace( /_/g, ' ' ).trim().replace( /^<\s*(.*)\s*>$/, '$1' ).replace( /^@/, '' ).split('#')[0].substring(0, 250).trim();
	if ( /^(?:https?:)?\/\/([a-z\d-]{1,50})\.(?:gamepedia\.com\/|(?:fandom\.com|wikia\.org)\/(?:[a-z-]{1,8}\/)?wiki\/)/.test(username) ) {
		username = decodeURIComponent( username.replace( /^(?:https?:)?\/\/([a-z\d-]{1,50})\.(?:gamepedia\.com\/|(?:fandom\.com|wikia\.org)\/(?:[a-z-]{1,8}\/)?wiki\/)/, '' ) );
	}
	if ( wiki.endsWith( '.gamepedia.com/' ) ) username = username.replace( /^userprofile\s*:/i, '' );
	
	db.all( 'SELECT role, editcount, usergroup, accountage, rename FROM verification WHERE guild = ? AND channel LIKE ? ORDER BY configid ASC', [msg.guild.id, '%|' + msg.channel.id + '|%'], (dberror, rows) => {
		if ( dberror || !rows ) {
			console.log( '- Error while getting the verifications: ' + dberror );
			embed.setTitle( username.escapeFormatting() ).setColor('#000000').setDescription( lang.verify.error );
			msg.replyMsg( lang.verify.error_reply, {embed}, false, false ).then( message => message.reactEmoji('error') );
			return dberror;
		}
		if ( !rows.length ) return msg.replyMsg( lang.verify.missing );
		
		if ( !username.trim() ) {
			args[0] = line.split(' ')[1];
			if ( args[0] === 'verification' ) args[0] = 'verify';
			return cmd_help(lang, msg, args, line);
		}
		var embed = new Discord.MessageEmbed().setFooter( lang.verify.footer + ' • ' + new Date().toLocaleString(lang.dateformat, timeoptions) ).setTimestamp();
		msg.reactEmoji('⏳').then( reaction => got.get( wiki + 'api.php?action=query&meta=siteinfo&siprop=general&list=users&usprop=blockinfo|groups|groupmemberships|editcount|registration&ususers=' + encodeURIComponent( username ) + '&format=json', {
			responseType: 'json'
		} ).then( response => {
			var body = response.body;
			if ( body && body.warnings ) log_warn(body.warnings);
			if ( response.statusCode !== 200 || !body || !body.query || !body.query.users ) {
				if ( wiki.noWiki(response.url) || response.statusCode === 410 ) {
					console.log( '- This wiki doesn\'t exist!' );
					msg.reactEmoji('nowiki');
				}
				else {
					console.log( '- ' + response.statusCode + ': Error while getting the user: ' + ( body && body.error && body.error.info ) );
					embed.setTitle( username.escapeFormatting() ).setColor('#000000').setDescription( lang.verify.error );
					msg.replyMsg( lang.verify.error_reply, {embed}, false, false ).then( message => message.reactEmoji('error') );
				}
				
				if ( reaction ) reaction.removeEmoji();
				return;
			}
			var queryuser = body.query.users[0];
			embed.setAuthor( body.query.general.sitename );
			if ( body.query.users.length !== 1 || queryuser.missing !== undefined || queryuser.invalid !== undefined ) {
				username = ( body.query.users.length === 1 ? queryuser.name : username );
				embed.setTitle( username.escapeFormatting() ).setColor('#0000FF').setDescription( lang.verify.user_missing.replaceSave( '%s', username.escapeFormatting() ) );
				msg.replyMsg( lang.verify.user_missing_reply.replaceSave( '%s', username.escapeFormatting() ), {embed}, false, false );
				
				if ( reaction ) reaction.removeEmoji();
				return;
			}
			username = queryuser.name;
			var pagelink = wiki.toLink('User:' + username, '', '', body.query.general, true);
			embed.setTitle( username.escapeFormatting() ).setURL( pagelink );
			if ( queryuser.blockexpiry ) {
				embed.setColor('#FF0000').setDescription( lang.verify.user_blocked.replaceSave( '%s', '[' + username.escapeFormatting() + '](' + pagelink + ')' ) );
				msg.replyMsg( lang.verify.user_blocked_reply.replaceSave( '%s', username.escapeFormatting() ), {embed}, false, false );
				
				if ( reaction ) reaction.removeEmoji();
				return;
			}
			
			var comment = [];
			var url = '';
			if ( wiki.endsWith( '.gamepedia.com/' ) ) {
				url = 'https://help.gamepedia.com/Special:GlobalBlockList/' + encodeURIComponent( username ) + '?uselang=qqx';
			}
			else if ( wiki.isFandom() ) {
				url = 'https://community.fandom.com/Special:Contributions/' + encodeURIComponent( username ) + '?limit=1';
			}
			if ( url ) return got.get( url ).then( gbresponse => {
				if ( gbresponse.statusCode !== 200 || !gbresponse.body ) {
					console.log( '- ' + gbresponse.statusCode + ': Error while getting the global block.' );
					comment.push(lang.verify.failed_gblock);
				}
				else {
					let $ = cheerio.load(gbresponse.body);
					if ( wiki.endsWith( '.gamepedia.com/' ) ) {
						if ( $('.mw-blocklist').length ) {
							return Promise.reject({
								desc: lang.verify.user_gblocked.replaceSave( '%s', '[' + username.escapeFormatting() + '](' + pagelink + ')' ),
								reply: lang.verify.user_gblocked_reply.replaceSave( '%s', username.escapeFormatting() )
							});
						}
					}
					else if ( wiki.isFandom() ) {
						if ( $('#mw-content-text .errorbox').length ) {
							return Promise.reject({
								desc: lang.verify.user_disabled.replaceSave( '%s', '[' + username.escapeFormatting() + '](' + pagelink + ')' ),
								reply: lang.verify.user_disabled_reply.replaceSave( '%s', username.escapeFormatting() )
							});
						}
						else if ( $('.mw-warning-with-logexcerpt').length && !$(".mw-warning-with-logexcerpt .mw-logline-block").length ) {
							return Promise.reject({
								desc: lang.verify.user_gblocked.replaceSave( '%s', '[' + username.escapeFormatting() + '](' + pagelink + ')' ),
								reply: lang.verify.user_gblocked_reply.replaceSave( '%s', username.escapeFormatting() )
							});
						}
					}
				}
			}, error => {
				console.log( '- Error while getting the global block: ' + error );
				comment.push(lang.verify.failed_gblock);
			} ).then( async () => {
				// async check for editcount on Gamepedia, workaround for https://gitlab.com/hydrawiki/hydra/-/issues/5054
				if ( wiki.endsWith( '.gamepedia.com/' ) ) {
					try {
						let ucresponse = await got.get( wiki + 'api.php?action=query&list=usercontribs&ucprop=&uclimit=500&ucuser=' + encodeURIComponent( username ) + '&format=json', {
							responseType: 'json'
						} );
						if ( !ucresponse.body.continue ) queryuser.editcount = ucresponse.body.query.usercontribs.length;
					} catch ( ucerror ) {
						console.log( '- Error while working around the edit count: ' + ucerror )
					}
				}
				
				var options = {responseType: 'json'};
				if ( wiki.endsWith( '.gamepedia.com/' ) ) {
					url = wiki + 'api.php?action=profile&do=getPublicProfile&user_name=' + encodeURIComponent( username ) + '&format=json&cache=' + Date.now();
				}
				else if ( wiki.isFandom() ) {
					url = 'https://services.fandom.com/user-attribute/user/' + queryuser.userid + '/attr/discordHandle?format=json&cache=' + Date.now();
					options.headers = {Accept: 'application/hal+json'};
				}
				got.get( url, options ).then( presponse => {
					var pbody = presponse.body;
					if ( presponse.statusCode !== 200 || !pbody || pbody.error || pbody.errormsg || pbody.title || !( pbody.profile || pbody.value !== undefined ) ) {
						if ( !( pbody && pbody.status === 404 ) ) {
							console.log( '- ' + presponse.statusCode + ': Error while getting the Discord tag: ' + ( pbody && ( pbody.error && pbody.error.info || pbody.errormsg || pbody.title ) ) );
							embed.setColor('#000000').setDescription( lang.verify.error );
							msg.replyMsg( lang.verify.error_reply, {embed}, false, false ).then( message => message.reactEmoji('error') );
							
							if ( reaction ) reaction.removeEmoji();
							return;
						}
					}
					
					var discordname = '';
					if ( pbody.profile ) discordname = pbody.profile['link-discord'].escapeFormatting().replace( /^\s*([^@#:]{2,32}?)\s*#(\d{4,6})\s*$/, '$1#$2' );
					else if ( pbody.value ) discordname = htmlToPlain( pbody.value ).replace( /^\s*([^@#:]{2,32}?)\s*#(\d{4,6})\s*$/, '$1#$2' );
					if ( discordname.length > 50 ) discordname = discordname.substring(0, 50) + '\u2026';
					embed.addField( lang.verify.discord, msg.author.tag.escapeFormatting(), true ).addField( lang.verify.wiki, ( discordname || lang.verify.empty ), true );
					if ( msg.author.tag.escapeFormatting() !== discordname ) {
						embed.setColor('#FFFF00').setDescription( lang.verify.user_failed.replaceSave( '%1$s', msg.member.toString() ).replaceSave( '%2$s', '[' + username.escapeFormatting() + '](' + pagelink + ')' ) );
						var help_link = '';
						if ( wiki.endsWith( '.gamepedia.com/' ) ) help_link = lang.verify.help_gamepedia;
						else if ( wiki.isFandom() ) help_link = lang.verify.help_fandom + '/' + username.toTitle(true) + '?c=' + ( msg.guild.id in patreons && patreons[msg.guild.id] !== process.env.prefix ? encodeURIComponent( patreons[msg.guild.id] + ' verify' ) : 'wb' ) + ( msg.channel.name !== 'verification' ? '&ch=' + encodeURIComponent( msg.channel.name ) : '' ) + '&user=' + encodeURIComponent( msg.author.username ) + '&tag=' + msg.author.discriminator;
						if ( help_link.length ) embed.addField( lang.verify.notice, lang.verify.help_guide.replaceSave( '%s', help_link ) + '\n' + help_link );
						msg.replyMsg( lang.verify.user_failed_reply.replaceSave( '%s', username.escapeFormatting() ), {embed}, false, false );
						
						if ( reaction ) reaction.removeEmoji();
						return;
					}
					
					var roles = [];
					var missing = [];
					var verified = false;
					var rename = false;
					var accountage = ( Date.now() - new Date(queryuser.registration) ) / 86400000;
					rows.forEach( row => {
						var and_or = 'some';
						if ( row.usergroup.startsWith( 'AND|' ) ) {
							row.usergroup = row.usergroup.replace( 'AND|', '' );
							and_or = 'every';
						}
						if ( queryuser.editcount >= row.editcount && row.usergroup.split('|')[and_or]( usergroup => {
							if ( !queryuser.groupmemberships ) return queryuser.groups.includes( usergroup );
							if ( !queryuser.groups.includes( 'global_' + usergroup ) || queryuser.groupmemberships.some( member => member.group === usergroup ) ) {
								return queryuser.groups.includes( usergroup );
							}
							return false;
						} ) && accountage >= row.accountage && row.role.split('|').some( role => !roles.includes( role ) ) ) {
							verified = true;
							if ( row.rename ) rename = true;
							row.role.split('|').forEach( role => {
								if ( !roles.includes( role ) ) {
									if ( msg.guild.roles.cache.has(role) && msg.guild.me.roles.highest.comparePositionTo(role) > 0 ) roles.push(role);
									else if ( !missing.includes( role ) ) missing.push(role);
								}
							} );
						}
					} );
					if ( verified ) {
						embed.setColor('#00FF00').setDescription( lang.verify.user_verified.replaceSave( '%1$s', msg.member.toString() ).replaceSave( '%2$s', '[' + username.escapeFormatting() + '](' + pagelink + ')' ) + ( rename ? '\n' + lang.verify.user_renamed : '' ) );
						var text = lang.verify.user_verified_reply.replaceSave( '%s', username.escapeFormatting() );
						var verify_promise = [
							msg.member.roles.add( roles, lang.verify.audit_reason.replaceSave( '%s', username ) ).catch( error => {
								embed.setColor('#008800');
								comment.push(lang.verify.failed_roles);
							} )
						];
						if ( rename ) {
							verify_promise.push(msg.member.setNickname( username.substring(0, 32), lang.verify.audit_reason.replaceSave( '%s', username ) ).catch( error => {
								embed.setColor('#008800');
								comment.push(lang.verify.failed_rename);
							} ));
						}
						return Promise.all(verify_promise).finally( () => {
							if ( msg.showEmbed() ) {
								if ( roles.length ) embed.addField( lang.verify.qualified, roles.map( role => '<@&' + role + '>' ).join('\n') );
								if ( missing.length ) embed.setColor('#008800').addField( lang.verify.qualified_error, missing.map( role => '<@&' + role + '>' ).join('\n') );
								if ( comment.length ) embed.setColor('#008800').addField( lang.verify.notice, comment.join('\n') );
							}
							else {
								if ( roles.length ) text += '\n\n' + lang.verify.qualified + ' ' + roles.map( role => '<@&' + role + '>' ).join(', ');
								if ( missing.length ) text += '\n\n' + lang.verify.qualified_error + ' ' + missing.map( role => '<@&' + role + '>' ).join(', ');
								if ( comment.length ) text += '\n\n' + comment.join('\n');
							}
							msg.replyMsg( text, {embed,split:true}, false, false );
							
							if ( reaction ) reaction.removeEmoji();
						} );
					}
					
					embed.setColor('#FFFF00').setDescription( lang.verify.user_matches.replaceSave( '%1$s', msg.member.toString() ).replaceSave( '%2$s', '[' + username.escapeFormatting() + '](' + pagelink + ')' ) );
					msg.replyMsg( lang.verify.user_matches_reply.replaceSave( '%s', username.escapeFormatting() ), {embed}, false, false );
					
					if ( reaction ) reaction.removeEmoji();
				}, error => {
					console.log( '- Error while getting the Discord tag: ' + error );
					embed.setColor('#000000').setDescription( lang.verify.error );
					msg.replyMsg( lang.verify.error_reply, {embed}, false, false ).then( message => message.reactEmoji('error') );
					
					if ( reaction ) reaction.removeEmoji();
				} );
			}, error => {
				embed.setColor('#FF0000').setDescription( error.desc );
				msg.replyMsg( error.reply, {embed}, false, false );
				
				if ( reaction ) reaction.removeEmoji();
			} );
			
			got.get( wiki + 'api.php?action=query&prop=revisions&rvprop=content|user&rvslots=main&titles=User:' + encodeURIComponent( username ) + '/Discord&format=json', {
				responseType: 'json'
			} ).then( mwresponse => {
				var mwbody = mwresponse.body;
				if ( mwbody && mwbody.warnings ) log_warn(mwbody.warnings);
				if ( mwresponse.statusCode !== 200 || !mwbody || mwbody.batchcomplete === undefined || !mwbody.query || !mwbody.query.pages ) {
					console.log( '- ' + mwresponse.statusCode + ': Error while getting the Discord tag: ' + ( mwbody && mwbody.error && mwbody.error.info ) );
					embed.setColor('#000000').setDescription( lang.verify.error );
					msg.replyMsg( lang.verify.error_reply, {embed}, false, false ).then( message => message.reactEmoji('error') );
					
					if ( reaction ) reaction.removeEmoji();
					return;
				}
				var revision = Object.values(mwbody.query.pages)[0]?.revisions?.[0];
				
				var discordname = '';
				if ( revision && revision.user === username ) discordname = revision.slots.main['*'].escapeFormatting().replace( /^\s*([^@#:]{2,32}?)\s*#(\d{4,6})\s*$/, '$1#$2' );
				if ( discordname.length > 50 ) discordname = discordname.substring(0, 50) + '\u2026';
				embed.addField( lang.verify.discord, msg.author.tag.escapeFormatting(), true ).addField( lang.verify.wiki, ( discordname || lang.verify.empty ), true );
				if ( msg.author.tag.escapeFormatting() !== discordname ) {
					embed.setColor('#FFFF00').setDescription( lang.verify.user_failed.replaceSave( '%1$s', msg.member.toString() ).replaceSave( '%2$s', '[' + username.escapeFormatting() + '](' + pagelink + ')' ) );
					embed.addField( lang.verify.notice, lang.verify.help_subpage.replaceSave( '%s', '**`' + msg.author.tag + '`**' ) + '\n' + wiki.toLink('Special:MyPage/Discord', 'action=edit', '', body.query.general) );
					msg.replyMsg( lang.verify.user_failed_reply.replaceSave( '%s', username.escapeFormatting() ), {embed}, false, false );
					
					if ( reaction ) reaction.removeEmoji();
					return;
				}
				
				var roles = [];
				var missing = [];
				var verified = false;
				var rename = false;
				var accountage = ( Date.now() - new Date(queryuser.registration) ) / 86400000;
				rows.forEach( row => {
					var and_or = 'some';
					if ( row.usergroup.startsWith( 'AND|' ) ) {
						row.usergroup = row.usergroup.replace( 'AND|', '' );
						and_or = 'every';
					}
					if ( queryuser.editcount >= row.editcount && row.usergroup.split('|')[and_or]( usergroup => {
						if ( !queryuser.groupmemberships ) return queryuser.groups.includes( usergroup );
						if ( !queryuser.groups.includes( 'global_' + usergroup ) || queryuser.groupmemberships.some( member => member.group === usergroup ) ) {
							return queryuser.groups.includes( usergroup );
						}
						return false;
					} ) && accountage >= row.accountage && row.role.split('|').some( role => !roles.includes( role ) ) ) {
						verified = true;
						if ( row.rename ) rename = true;
						row.role.split('|').forEach( role => {
							if ( !roles.includes( role ) ) {
								if ( msg.guild.roles.cache.has(role) && msg.guild.me.roles.highest.comparePositionTo(role) > 0 ) roles.push(role);
								else if ( !missing.includes( role ) ) missing.push(role);
							}
						} );
					}
				} );
				if ( verified ) {
					embed.setColor('#00FF00').setDescription( lang.verify.user_verified.replaceSave( '%1$s', msg.member.toString() ).replaceSave( '%2$s', '[' + username.escapeFormatting() + '](' + pagelink + ')' ) + ( rename ? '\n' + lang.verify.user_renamed : '' ) );
					var text = lang.verify.user_verified_reply.replaceSave( '%s', username.escapeFormatting() );
					var verify_promise = [
						msg.member.roles.add( roles, lang.verify.audit_reason.replaceSave( '%s', username ) ).catch( error => {
							embed.setColor('#008800');
							comment.push(lang.verify.failed_roles);
						} )
					];
					if ( rename ) {
						verify_promise.push(msg.member.setNickname( username.substring(0, 32), lang.verify.audit_reason.replaceSave( '%s', username ) ).catch( error => {
							embed.setColor('#008800');
							comment.push(lang.verify.failed_rename);
						} ));
					}
					return Promise.all(verify_promise).finally( () => {
						if ( msg.showEmbed() ) {
							if ( roles.length ) embed.addField( lang.verify.qualified, roles.map( role => '<@&' + role + '>' ).join('\n') );
							if ( missing.length ) embed.setColor('#008800').addField( lang.verify.qualified_error, missing.map( role => '<@&' + role + '>' ).join('\n') );
							if ( comment.length ) embed.setColor('#008800').addField( lang.verify.notice, comment.join('\n') );
						}
						else {
							if ( roles.length ) text += '\n\n' + lang.verify.qualified + ' ' + roles.map( role => '<@&' + role + '>' ).join(', ');
							if ( missing.length ) text += '\n\n' + lang.verify.qualified_error + ' ' + missing.map( role => '<@&' + role + '>' ).join(', ');
							if ( comment.length ) text += '\n\n' + comment.join('\n');
						}
						msg.replyMsg( text, {embed,split:true}, false, false );
						
						if ( reaction ) reaction.removeEmoji();
					} );
				}
				
				embed.setColor('#FFFF00').setDescription( lang.verify.user_matches.replaceSave( '%1$s', msg.member.toString() ).replaceSave( '%2$s', '[' + username.escapeFormatting() + '](' + pagelink + ')' ) );
				msg.replyMsg( lang.verify.user_matches_reply.replaceSave( '%s', username.escapeFormatting() ), {embed}, false, false );
				
				if ( reaction ) reaction.removeEmoji();
			}, error => {
				console.log( '- Error while getting the Discord tag: ' + error );
				embed.setColor('#000000').setDescription( lang.verify.error );
				msg.replyMsg( lang.verify.error_reply, {embed}, false, false ).then( message => message.reactEmoji('error') );
				
				if ( reaction ) reaction.removeEmoji();
			} );
		}, error => {
			console.log( '- Error while getting the user: ' + error );
			embed.setColor('#000000').setDescription( lang.verify.error );
			msg.replyMsg( lang.verify.error_reply, {embed}, false, false ).then( message => message.reactEmoji('error') );
			
			if ( reaction ) reaction.removeEmoji();
		} ) );
	} );
}

function gamepedia_user(lang, msg, namespace, username, wiki, querystring, fragment, querypage, contribs, reaction, spoiler) {
	if ( /^(?:(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{2})?|(?:[\dA-F]{1,4}:){7}[\dA-F]{1,4}(?:\/\d{2,3})?)$/.test(username) ) {
		got.get( wiki + 'api.php?action=query&meta=siteinfo&siprop=general&list=blocks&bkprop=user|by|timestamp|expiry|reason&bkip=' + encodeURIComponent( username ) + '&format=json', {
			responseType: 'json'
		} ).then( response => {
			var body = response.body;
			if ( body && body.warnings ) log_warn(body.warnings);
			if ( response.statusCode !== 200 || !body || body.batchcomplete === undefined || !body.query || !body.query.blocks ) {
				if ( body && body.error && ( body.error.code === 'param_ip' || body.error.code === 'cidrtoobroad' ) ) {
					if ( querypage.missing !== undefined || querypage.ns === -1 ) msg.reactEmoji('error');
					else {
						var pagelink = wiki.toLink(querypage.title, querystring.toTitle(), fragment);
						var embed = new Discord.MessageEmbed().setTitle( querypage.title.escapeFormatting() ).setURL( pagelink );
						if ( querypage.pageprops && querypage.pageprops.displaytitle ) {
							var displaytitle = htmlToDiscord( querypage.pageprops.displaytitle );
							if ( displaytitle.length > 250 ) displaytitle = displaytitle.substring(0, 250) + '\u2026';
							embed.setTitle( displaytitle );
						}
						if ( querypage.pageprops && querypage.pageprops.description ) {
							var description = htmlToPlain( querypage.pageprops.description );
							if ( description.length > 2000 ) description = description.substring(0, 2000) + '\u2026';
							embed.setDescription( description );
						}
						else if ( querypage.extract ) {
							var extract = querypage.extract.escapeFormatting();
							if ( extract.length > 2000 ) extract = extract.substring(0, 2000) + '\u2026';
							embed.setDescription( extract );
						}
						if ( querypage.pageimage && querypage.original ) {
							var pageimage = querypage.original.source;
							embed.setThumbnail( pageimage );
						}
						
						msg.sendChannel( spoiler + '<' + pagelink + '>' + spoiler, {embed} );
					}
				}
				else {
					console.log( '- ' + response.statusCode + ': Error while getting the search results: ' + ( body && body.error && body.error.info ) );
					msg.sendChannelError( spoiler + '<' + wiki.toLink(( querypage.noRedirect ? namespace : contribs ) + username, querystring.toTitle(), fragment) + '>' + spoiler );
				}
				
				if ( reaction ) reaction.removeEmoji();
			}
			else {
				if ( !querypage.noRedirect || ( querypage.missing === undefined && querypage.ns !== -1 ) ) namespace = contribs;
				var blocks = body.query.blocks.map( block => {
					var isBlocked = false;
					var blockedtimestamp = new Date(block.timestamp).toLocaleString(lang.dateformat, timeoptions);
					var blockexpiry = block.expiry;
					if ( blockexpiry === 'infinity' ) {
						blockexpiry = lang.user.block.until_infinity;
						isBlocked = true;
					} else if ( blockexpiry ) {
						if ( Date.parse(blockexpiry) > Date.now() ) isBlocked = true;
						blockexpiry = new Date(blockexpiry).toLocaleString(lang.dateformat, timeoptions);
					}
					if ( isBlocked ) return {
						header: lang.user.block.header.replaceSave( '%s', block.user ).escapeFormatting(),
						text: lang.user.block[( block.reason ? 'text' : 'noreason' )].replaceSave( '%1$s', blockedtimestamp ).replaceSave( '%2$s', blockexpiry ),
						by: block.by,
						reason: block.reason
					};
				} ).filter( block => block !== undefined );
				if ( username.includes( '/' ) ) {
					var rangeprefix = username;
					if ( username.includes( ':' ) ) {
						var range = parseInt(username.replace( /^.+\/(\d{2,3})$/, '$1' ), 10);
						if ( range === 128 ) username = username.replace( /^(.+)\/\d{2,3}$/, '$1' );
						else if ( range >= 112 ) rangeprefix = username.replace( /^((?:[\dA-F]{1,4}:){7}).+$/, '$1' );
						else if ( range >= 96 ) rangeprefix = username.replace( /^((?:[\dA-F]{1,4}:){6}).+$/, '$1' );
						else if ( range >= 80 ) rangeprefix = username.replace( /^((?:[\dA-F]{1,4}:){5}).+$/, '$1' );
						else if ( range >= 64 ) rangeprefix = username.replace( /^((?:[\dA-F]{1,4}:){4}).+$/, '$1' );
						else if ( range >= 48 ) rangeprefix = username.replace( /^((?:[\dA-F]{1,4}:){3}).+$/, '$1' );
						else if ( range >= 32 ) rangeprefix = username.replace( /^((?:[\dA-F]{1,4}:){2}).+$/, '$1' );
						else if ( range >= 19 ) rangeprefix = username.replace( /^((?:[\dA-F]{1,4}:){1}).+$/, '$1' );
					}
					else {
						var range = parseInt(username.substring(username.length - 2), 10);
						if ( range === 32 ) username = username.replace( /^(.+)\/\d{2}$/, '$1' );
						else if ( range >= 24 ) rangeprefix = username.replace( /^((?:\d{1,3}\.){3}).+$/, '$1' );
						else if ( range >= 16 ) rangeprefix = username.replace( /^((?:\d{1,3}\.){2}).+$/, '$1' );
					}
				}
				got.get( wiki + 'api.php?action=query&list=usercontribs&ucprop=&uclimit=50' + ( username.includes( '/' ) ? '&ucuserprefix=' + encodeURIComponent( rangeprefix ) : '&ucuser=' + encodeURIComponent( username ) ) + '&format=json', {
					responseType: 'json'
				} ).then( ucresponse => {
					var ucbody = ucresponse.body;
					if ( rangeprefix && !username.includes( '/' ) ) username = rangeprefix;
					if ( ucbody && ucbody.warnings ) log_warn(ucbody.warnings);
					if ( ucresponse.statusCode !== 200 || !ucbody || ucbody.batchcomplete === undefined || !ucbody.query || !ucbody.query.usercontribs ) {
						if ( ucbody && ucbody.error && ucbody.error.code === 'baduser_ucuser' ) {
							msg.reactEmoji('error');
						}
						else {
							console.log( '- ' + ucresponse.statusCode + ': Error while getting the search results: ' + ( ucbody && ucbody.error && ucbody.error.info ) );
							msg.sendChannelError( spoiler + '<' + wiki.toLink(namespace + username, querystring.toTitle(), fragment, body.query.general) + '>' + spoiler );
						}
					}
					else {
						var editcount = [lang.user.info.editcount, ( username.includes( '/' ) && ( ( username.includes( ':' ) && range % 16 ) || range % 8 ) ? '~' : '' ) + ucbody.query.usercontribs.length + ( ucbody.continue ? '+' : '' )];
						
						var pagelink = wiki.toLink(namespace + username, querystring.toTitle(), fragment, body.query.general);
						if ( msg.showEmbed() ) {
							var text = '<' + pagelink + '>';
							var embed = new Discord.MessageEmbed().setAuthor( body.query.general.sitename ).setTitle( username ).setURL( pagelink ).addField( editcount[0], '[' + editcount[1] + '](' + wiki.toLink(contribs + username, '', '', body.query.general, true) + ')' );
							if ( blocks.length ) blocks.forEach( block => {
								block.text = block.text.replaceSave( '%3$s', '[' + block.by.escapeFormatting() + '](' + wiki.toLink('User:' + block.by, '', '', body.query.general, true) + ')' );
								if ( block.reason ) block.text = block.text.replaceSave( '%4$s', block.reason.toMarkdown(wiki, body.query.general) );
								embed.addField( block.header, block.text );
							} );
							if ( msg.channel.type === 'text' && msg.guild.id in patreons ) embed.addField( '\u200b', '<a:loading:641343250661113886> **' + lang.user.info.loading + '**' );
						}
						else {
							var embed = {};
							var text = '<' + pagelink + '>\n\n' + editcount.join(' ');
							if ( blocks.length ) blocks.forEach( block => {
								block.text = block.text.replaceSave( '%3$s', block.by.escapeFormatting() );
								if ( block.reason ) block.text = block.text.replaceSave( '%4$s', block.reason.toPlaintext() );
								text += '\n\n**' + block.header + '**\n' + block.text;
							} );
							if ( msg.channel.type === 'text' && msg.guild.id in patreons ) text += '\n\n<a:loading:641343250661113886> **' + lang.user.info.loading + '**';
						}
						
						msg.sendChannel( spoiler + text + spoiler, {embed} ).then( message => global_block(lang, message, username, text, embed, wiki, spoiler) );
					}
				}, error => {
					if ( rangeprefix && !username.includes( '/' ) ) username = rangeprefix;
					console.log( '- Error while getting the search results: ' + error );
					msg.sendChannelError( spoiler + '<' + wiki.toLink(namespace + username, querystring.toTitle(), fragment, body.query.general) + '>' + spoiler );
				} ).finally( () => {
					if ( reaction ) reaction.removeEmoji();
				} );
			}
		}, error => {
			console.log( '- Error while getting the search results: ' + error );
			msg.sendChannelError( spoiler + '<' + wiki.toLink(( querypage.noRedirect ? namespace : contribs ) + username, querystring.toTitle(), fragment) + '>' + spoiler );
			
			if ( reaction ) reaction.removeEmoji();
		} );
	} else {
		got.get( wiki + 'api.php?action=query&meta=siteinfo&siprop=general&list=users&usprop=blockinfo|groups|groupmemberships|editcount|registration|gender&ususers=' + encodeURIComponent( username ) + '&format=json', {
			responseType: 'json'
		} ).then( response => {
			var body = response.body;
			if ( body && body.warnings ) log_warn(body.warnings);
			if ( response.statusCode !== 200 || !body || body.batchcomplete === undefined || !body.query || !body.query.users || !body.query.users[0] ) {
				console.log( '- ' + response.statusCode + ': Error while getting the search results: ' + ( body && body.error && body.error.info ) );
				msg.sendChannelError( spoiler + '<' + wiki.toLink(namespace + username, querystring.toTitle(), fragment) + '>' + spoiler );
				
				if ( reaction ) reaction.removeEmoji();
			}
			else {
				var queryuser = body.query.users[0];
				if ( queryuser.missing !== undefined || queryuser.invalid !== undefined ) {
					if ( querypage.missing !== undefined || querypage.ns === -1 ) msg.reactEmoji('🤷');
					else {
						var pagelink = wiki.toLink(querypage.title, querystring.toTitle(), fragment, body.query.general);
						var embed = new Discord.MessageEmbed().setAuthor( body.query.general.sitename ).setTitle( querypage.title.escapeFormatting() ).setURL( pagelink );
						if ( querypage.pageprops && querypage.pageprops.displaytitle ) {
							var displaytitle = htmlToDiscord( querypage.pageprops.displaytitle );
							if ( displaytitle.length > 250 ) displaytitle = displaytitle.substring(0, 250) + '\u2026';
							embed.setTitle( displaytitle );
						}
						if ( querypage.pageprops && querypage.pageprops.description ) {
							var description = htmlToPlain( querypage.pageprops.description );
							if ( description.length > 2000 ) description = description.substring(0, 2000) + '\u2026';
							embed.setDescription( description );
						}
						else if ( querypage.extract ) {
							var extract = querypage.extract.escapeFormatting();
							if ( extract.length > 2000 ) extract = extract.substring(0, 2000) + '\u2026';
							embed.setDescription( extract );
						}
						if ( querypage.pageimage && querypage.original ) {
							var pageimage = querypage.original.source;
							embed.setThumbnail( pageimage );
						} else embed.setThumbnail( ( body.query.general.logo.startsWith( '//' ) ? 'https:' : '' ) + body.query.general.logo );
						
						msg.sendChannel( spoiler + '<' + pagelink + '>' + spoiler, {embed} );
					}
					
					if ( reaction ) reaction.removeEmoji();
				}
				else {
					username = queryuser.name;
					var gender = [lang.user.info.gender];
					switch (queryuser.gender) {
						case 'male':
							gender.push(lang.user.gender.male);
							break;
						case 'female':
							gender.push(lang.user.gender.female);
							break;
						default: 
							gender.push(lang.user.gender.unknown);
					}
					var registration = [lang.user.info.registration, new Date(queryuser.registration).toLocaleString(lang.dateformat, timeoptions)];
					var editcount = [lang.user.info.editcount, queryuser.editcount];
					var groups = queryuser.groups;
					var group = [lang.user.info.group];
					var grouplist = lang.user.groups;
					for ( var i = 0; i < grouplist.length; i++ ) {
						if ( groups.includes( grouplist[i][0] ) && ( group.length === 1 || !['autoconfirmed', 'user'].includes( grouplist[i][0] ) ) ) {
							var thisSite = allSites.find( site => site.wiki_domain === body.query.general.servername );
							if ( grouplist[i][0] === 'wiki_manager' && thisSite && thisSite.wiki_managers.includes( username ) ) {
								group.push('**' + grouplist[i][1] + '**');
							}
							else if ( !groups.includes( 'global_' + grouplist[i][0] ) || queryuser.groupmemberships.some( member => member.group === grouplist[i][0] ) ) {
								group.push(grouplist[i][1]);
							}
						}
					}
					var isBlocked = false;
					var blockedtimestamp = new Date(queryuser.blockedtimestamp).toLocaleString(lang.dateformat, timeoptions);
					var blockexpiry = queryuser.blockexpiry;
					if ( blockexpiry === 'infinity' ) {
						blockexpiry = lang.user.block.until_infinity;
						isBlocked = true;
					} else if ( blockexpiry ) {
						var blockexpirydate = blockexpiry.replace( /(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2,3})/, '$1-$2-$3T$4:$5:$6Z' );
						blockexpiry = new Date(blockexpirydate).toLocaleString(lang.dateformat, timeoptions);
						if ( Date.parse(blockexpirydate) > Date.now() ) isBlocked = true;
					}
					var blockedby = queryuser.blockedby;
					var blockreason = queryuser.blockreason;
					var block = {
						header: lang.user.block.header.replaceSave( '%s', username ).escapeFormatting(),
						text: lang.user.block[( blockreason ? 'text' : 'noreason' )].replaceSave( '%1$s', blockedtimestamp ).replaceSave( '%2$s', blockexpiry ),
						by: blockedby,
						reason: blockreason
					};
					
					var pagelink = wiki.toLink(namespace + username, querystring.toTitle(), fragment, body.query.general);
					if ( msg.showEmbed() ) {
						var text = '<' + pagelink + '>';
						var embed = new Discord.MessageEmbed().setAuthor( body.query.general.sitename ).setTitle( username.escapeFormatting() ).setURL( pagelink ).addField( editcount[0], '[' + editcount[1] + '](' + wiki.toLink(contribs + username, '', '', body.query.general, true) + ')', true ).addField( group[0], group.slice(1).join(',\n'), true ).addField( gender[0], gender[1], true ).addField( registration[0], registration[1], true );
						
						if ( querypage.pageprops && querypage.pageprops.description ) {
							var description = htmlToPlain( querypage.pageprops.description );
							if ( description.length > 2000 ) description = description.substring(0, 2000) + '\u2026';
							embed.setDescription( description );
						}
						else if ( querypage.extract ) {
							var extract = querypage.extract.escapeFormatting();
							if ( extract.length > 2000 ) extract = extract.substring(0, 2000) + '\u2026';
							embed.setDescription( extract );
						}
					}
					else {
						var embed = {};
						var text = '<' + pagelink + '>\n\n' + gender.join(' ') + '\n' + registration.join(' ') + '\n' + editcount.join(' ') + '\n' + group[0] + ' ' + group.slice(1).join(', ');
					}
					if ( wiki.endsWith( '.gamepedia.com/' ) ) got.get( wiki + 'api.php?action=profile&do=getPublicProfile&user_name=' + encodeURIComponent( username ) + '&format=json&cache=' + Date.now(), {
						responseType: 'json'
					} ).then( presponse => {
						var pbody = presponse.body;
						if ( presponse.statusCode !== 200 || !pbody || pbody.error || pbody.errormsg || !pbody.profile ) {
							console.log( '- ' + presponse.statusCode + ': Error while getting the user profile: ' + ( pbody && ( pbody.error && pbody.error.info || pbody.errormsg ) ) );
						}
						else {
							if ( pbody.profile['link-discord'] ) {
								if ( pbody.profile['link-discord'].length > 50 ) pbody.profile['link-discord'] = pbody.profile['link-discord'].substring(0, 50) + '\u2026';
								if ( msg.channel.type === 'text' ) var discordmember = msg.guild.members.cache.find( member => {
									return member.user.tag === pbody.profile['link-discord'].replace( /^\s*([^@#:]{2,32}?)\s*#(\d{4,6})\s*$/, '$1#$2' );
								} );
								var discordname = [lang.user.info.discord,pbody.profile['link-discord'].escapeFormatting()];
								if ( discordmember ) discordname[1] = discordmember.toString();
								
								if ( msg.showEmbed() ) embed.addField( discordname[0], discordname[1], true );
								else text += '\n' + discordname.join(' ');
							}
							if ( pbody.profile['favwiki'] ) {
								var favwiki = [lang.user.info.favwiki,allSites.find( site => site.md5_key === pbody.profile['favwiki'] )];
								if ( favwiki[1] ) {
									if ( msg.showEmbed() ) embed.addField( favwiki[0], '[' + favwiki[1].wiki_display_name + '](<https://' + favwiki[1].wiki_domain + '/>)', true );
									else text += '\n' + favwiki[0] + ' <https://' + favwiki[1].wiki_domain + '/>';
								}
							}
						}
					}, error => {
						console.log( '- Error while getting the user profile: ' + error );
					} ).finally( () => {
						if ( msg.showEmbed() ) {
							if ( isBlocked ) {
								block.text = block.text.replaceSave( '%3$s', '[' + block.by.escapeFormatting() + '](' + wiki.toLink('User:' + block.by, '', '', body.query.general, true) + ')' );
								if ( block.reason ) block.text = block.text.replaceSave( '%4$s', block.reason.toMarkdown(wiki, body.query.general) );
								embed.addField( block.header, block.text );
							}
							if ( msg.channel.type === 'text' && msg.guild.id in patreons ) embed.addField( '\u200b', '<a:loading:641343250661113886> **' + lang.user.info.loading + '**' );
						}
						else {
							if ( isBlocked ) {
								block.text = block.text.replaceSave( '%3$s', block.by.escapeFormatting() );
								if ( block.reason ) block.text = block.text.replaceSave( '%4$s', block.reason.toPlaintext() );
								text += '\n\n**' + block.header + '**\n' + block.text;
							}
							if ( msg.channel.type === 'text' && msg.guild.id in patreons ) text += '\n\n<a:loading:641343250661113886> **' + lang.user.info.loading + '**';
						}
						
						msg.sendChannel( spoiler + text + spoiler, {embed} ).then( message => global_block(lang, message, username, text, embed, wiki, spoiler) );
						
						if ( reaction ) reaction.removeEmoji();
					} );
					else if ( wiki.isFandom() ) got.get( 'https://services.fandom.com/user-attribute/user/' + queryuser.userid + '?format=json&cache=' + Date.now(), {
						headers: {
							Accept: 'application/hal+json'
						},
						responseType: 'json'
					} ).then( presponse => {
						var pbody = presponse.body;
						if ( presponse.statusCode !== 200 || !pbody || pbody.title || !pbody._embedded || !pbody._embedded.properties ) {
							if ( !( pbody && pbody.status === 404 ) ) {
								console.log( '- ' + presponse.statusCode + ': Error while getting the user profile: ' + ( pbody && pbody.title ) );
							}
						}
						else {
							var profile = pbody._embedded.properties;
							var discordfield = profile.find( field => field.name === 'discordHandle' );
							var avatarfield = profile.find( field => field.name === 'avatar' );
							var biofield = profile.find( field => field.name === 'bio' );
							if ( discordfield && discordfield.value ) {
								discordfield.value = htmlToPlain( discordfield.value ).replace( /^\s*([^@#:]{2,32}?)\s*#(\d{4,6})\s*$/, '$1#$2' );
								if ( discordfield.value.length > 50 ) discordfield.value = discordfield.value.substring(0, 50) + '\u2026';
								if ( msg.channel.type === 'text' ) var discordmember = msg.guild.members.cache.find( member => {
									return member.user.tag.escapeFormatting() === discordfield.value;
								} );
								var discordname = [lang.user.info.discord,discordfield.value];
								if ( discordmember ) discordname[1] = discordmember.toString();
								
								if ( msg.showEmbed() ) embed.addField( discordname[0], discordname[1], true );
								else text += '\n' + discordname.join(' ');
							}
							if ( msg.showEmbed() ) {
								if ( avatarfield && avatarfield.value ) embed.setThumbnail( avatarfield.value );
								if ( biofield && biofield.value && !embed.description ) {
									var bio = biofield.value.escapeFormatting();
									if ( bio.length > 2000 ) bio = bio.substring(0, 2000) + '\u2026';
									embed.setDescription( bio );
								}
							}
						}
					}, error => {
						console.log( '- Error while getting the user profile: ' + error );
					} ).finally( () => {
						if ( msg.showEmbed() ) {
							if ( isBlocked ) {
								block.text = block.text.replaceSave( '%3$s', '[' + block.by.escapeFormatting() + '](' + wiki.toLink('User:' + block.by, '', '', body.query.general, true) + ')' );
								if ( block.reason ) block.text = block.text.replaceSave( '%4$s', block.reason.toMarkdown(wiki, body.query.general) );
								embed.addField( block.header, block.text );
							}
							if ( msg.channel.type === 'text' && msg.guild.id in patreons ) embed.addField( '\u200b', '<a:loading:641343250661113886> **' + lang.user.info.loading + '**' );
						}
						else {
							if ( isBlocked ) {
								block.text = block.text.replaceSave( '%3$s', block.by.escapeFormatting() );
								if ( block.reason ) block.text = block.text.replaceSave( '%4$s', block.reason.toPlaintext() );
								text += '\n\n**' + block.header + '**\n' + block.text;
							}
							if ( msg.channel.type === 'text' && msg.guild.id in patreons ) text += '\n\n<a:loading:641343250661113886> **' + lang.user.info.loading + '**';
						}
						
						msg.sendChannel( spoiler + text + spoiler, {embed} ).then( message => global_block(lang, message, username, text, embed, wiki, spoiler) );
						
						if ( reaction ) reaction.removeEmoji();
					} );
					else {
						if ( isBlocked ) {
							if ( msg.showEmbed() ) {
								block.text = block.text.replaceSave( '%3$s', '[' + block.by.escapeFormatting() + '](' + wiki.toLink('User:' + block.by, '', '', body.query.general, true) + ')' );
								if ( block.reason ) block.text = block.text.replaceSave( '%4$s', block.reason.toMarkdown(wiki, body.query.general) );
								embed.addField( block.header, block.text );
							}
							else {
								block.text = block.text.replaceSave( '%3$s', block.by.escapeFormatting() );
								if ( block.reason ) block.text = block.text.replaceSave( '%4$s', block.reason.toPlaintext() );
								text += '\n\n**' + block.header + '**\n' + block.text;
							}
						}
						
						msg.sendChannel( spoiler + text + spoiler, {embed} );
						
						if ( reaction ) reaction.removeEmoji();
					}
				}
			}
		}, error => {
			console.log( '- Error while getting the search results: ' + error );
			msg.sendChannelError( spoiler + '<' + wiki.toLink(namespace + username, querystring.toTitle(), fragment) + '>' + spoiler );
			
			if ( reaction ) reaction.removeEmoji();
		} );
	}
}

function fandom_user(lang, msg, namespace, username, wiki, querystring, fragment, querypage, contribs, reaction, spoiler) {
	if ( /^(?:(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{2})?|(?:[\dA-F]{1,4}:){7}[\dA-F]{1,4}(?:\/\d{2,3})?)$/.test(username) ) {
		got.get( wiki + 'api.php?action=query&meta=siteinfo&siprop=general&list=blocks&bkprop=user|by|timestamp|expiry|reason&bkip=' + encodeURIComponent( username ) + '&format=json', {
			responseType: 'json'
		} ).then( response => {
			var body = response.body;
			if ( body && body.warnings ) log_warn(body.warnings);
			if ( response.statusCode !== 200 || !body || !body.query || !body.query.blocks ) {
				if ( body && body.error && ( body.error.code === 'param_ip' || body.error.code === 'cidrtoobroad' ) ) {
					if ( querypage.missing !== undefined || querypage.ns === -1 ) {
						msg.reactEmoji('error');
						
						if ( reaction ) reaction.removeEmoji();
					}
					else {
						var pagelink = wiki.toLink(querypage.title, querystring.toTitle(), fragment);
						var embed = new Discord.MessageEmbed().setTitle( querypage.title.escapeFormatting() ).setURL( pagelink );
						got.get( wiki.toDescLink(querypage.title) ).then( descresponse => {
							var descbody = descresponse.body;
							if ( descresponse.statusCode !== 200 || !descbody ) {
								console.log( '- ' + descresponse.statusCode + ': Error while getting the description.' );
							} else {
								var thumbnail = wiki.toLink('Special:FilePath/Wiki-wordmark.png');
								var parser = new htmlparser.Parser( {
									onopentag: (tagname, attribs) => {
										if ( tagname === 'meta' && attribs.property === 'og:description' ) {
											var description = attribs.content.escapeFormatting();
											if ( description.length > 2000 ) description = description.substring(0, 2000) + '\u2026';
											embed.setDescription( description );
										}
										if ( tagname === 'meta' && attribs.property === 'og:image' ) {
											thumbnail = attribs.content;
										}
									}
								}, {decodeEntities:true} );
								parser.write( descbody );
								parser.end();
								embed.setThumbnail( thumbnail );
							}
						}, error => {
							console.log( '- Error while getting the description: ' + error );
						} ).finally( () => {
							msg.sendChannel( spoiler + '<' + pagelink + '>' + spoiler, {embed} );
							
							if ( reaction ) reaction.removeEmoji();
						} );
					}
				}
				else {
					console.log( '- ' + response.statusCode + ': Error while getting the search results: ' + ( body && body.error && body.error.info ) );
					msg.sendChannelError( spoiler + '<' + wiki.toLink(( querypage.noRedirect ? namespace : contribs ) + username, querystring.toTitle(), fragment) + '>' + spoiler );
					
					if ( reaction ) reaction.removeEmoji();
				}
			}
			else {
				if ( !querypage.noRedirect || ( querypage.missing === undefined && querypage.ns !== -1 ) ) namespace = contribs;
				var blocks = body.query.blocks.map( block => {
					var isBlocked = false;
					var blockedtimestamp = new Date(block.timestamp).toLocaleString(lang.dateformat, timeoptions);
					var blockexpiry = block.expiry;
					if ( blockexpiry === 'infinity' ) {
						blockexpiry = lang.user.block.until_infinity;
						isBlocked = true;
					} else if ( blockexpiry ) {
						if ( Date.parse(blockexpiry) > Date.now() ) isBlocked = true;
						blockexpiry = new Date(blockexpiry).toLocaleString(lang.dateformat, timeoptions);
					}
					if ( isBlocked ) return {
						header: lang.user.block.header.replaceSave( '%s', block.user ).escapeFormatting(),
						text: lang.user.block[( block.reason ? 'text' : 'noreason' )].replaceSave( '%1$s', blockedtimestamp ).replaceSave( '%2$s', blockexpiry ),
						by: block.by,
						reason: block.reason
					};
				} ).filter( block => block !== undefined );
				if ( username.includes( '/' ) ) {
					var rangeprefix = username;
					if ( username.includes( ':' ) ) {
						var range = parseInt(username.replace( /^.+\/(\d{2,3})$/, '$1' ), 10);
						if ( range === 128 ) username = username.replace( /^(.+)\/\d{2,3}$/, '$1' );
						else if ( range >= 112 ) rangeprefix = username.replace( /^((?:[\dA-F]{1,4}:){7}).+$/, '$1' );
						else if ( range >= 96 ) rangeprefix = username.replace( /^((?:[\dA-F]{1,4}:){6}).+$/, '$1' );
						else if ( range >= 80 ) rangeprefix = username.replace( /^((?:[\dA-F]{1,4}:){5}).+$/, '$1' );
						else if ( range >= 64 ) rangeprefix = username.replace( /^((?:[\dA-F]{1,4}:){4}).+$/, '$1' );
						else if ( range >= 48 ) rangeprefix = username.replace( /^((?:[\dA-F]{1,4}:){3}).+$/, '$1' );
						else if ( range >= 32 ) rangeprefix = username.replace( /^((?:[\dA-F]{1,4}:){2}).+$/, '$1' );
						else if ( range >= 19 ) rangeprefix = username.replace( /^((?:[\dA-F]{1,4}:){1}).+$/, '$1' );
					}
					else {
						var range = parseInt(username.substring(username.length - 2), 10);
						if ( range === 32 ) username = username.replace( /^(.+)\/\d{2}$/, '$1' );
						else if ( range >= 24 ) rangeprefix = username.replace( /^((?:\d{1,3}\.){3}).+$/, '$1' );
						else if ( range >= 16 ) rangeprefix = username.replace( /^((?:\d{1,3}\.){2}).+$/, '$1' );
					}
				}
				got.get( wiki + 'api.php?action=query&list=usercontribs&ucprop=&uclimit=50&ucuser=' + encodeURIComponent( username ) + '&format=json', {
					responseType: 'json'
				} ).then( ucresponse => {
					var ucbody = ucresponse.body;
					if ( rangeprefix && !username.includes( '/' ) ) username = rangeprefix;
					if ( ucbody && ucbody.warnings ) log_warn(ucbody.warnings);
					if ( ucresponse.statusCode !== 200 || !ucbody || !ucbody.query || !ucbody.query.usercontribs ) {
						if ( ucbody && ucbody.error && ucbody.error.code === 'baduser_ucuser' ) {
							msg.reactEmoji('error');
						}
						else {
							console.log( '- ' + ucresponse.statusCode + ': Error while getting the search results: ' + ( ucbody && ucbody.error && ucbody.error.info ) );
							msg.sendChannelError( spoiler + '<' + wiki.toLink(namespace + username, querystring.toTitle(), fragment, body.query.general) + '>' + spoiler );
						}
					}
					else {
						var editcount = [lang.user.info.editcount, ( username.includes( '/' ) ? '~' : '' ) + ucbody.query.usercontribs.length + ( ucbody.continue ? '+' : '' )];
						
						var pagelink = wiki.toLink(namespace + username, querystring.toTitle(), fragment, body.query.general);
						if ( msg.showEmbed() ) {
							var text = '<' + pagelink + '>';
							var embed = new Discord.MessageEmbed().setAuthor( body.query.general.sitename ).setTitle( username ).setURL( pagelink ).addField( editcount[0], '[' + editcount[1] + '](' + wiki.toLink(contribs + username, '', '', body.query.general, true) + ')' );
							if ( blocks.length ) {
								block.text = block.text.replaceSave( '%3$s', '[' + block.by.escapeFormatting() + '](' + wiki.toLink('User:' + block.by, '', '', body.query.general, true) + ')' );
								if ( block.reason ) block.text = block.text.replaceSave( '%4$s', block.reason.toMarkdown(wiki, body.query.general) );
								embed.addField( block.header, block.text );
							}
							if ( msg.channel.type === 'text' && msg.guild.id in patreons ) embed.addField( '\u200b', '<a:loading:641343250661113886> **' + lang.user.info.loading + '**' );
						}
						else {
							var embed = {};
							var text = '<' + pagelink + '>\n\n' + editcount.join(' ');
							if ( blocks.length ) {
								block.text = block.text.replaceSave( '%3$s', block.by.escapeFormatting() );
								if ( block.reason ) block.text = block.text.replaceSave( '%4$s', block.reason.toPlaintext() );
								text += '\n\n**' + block.header + '**\n' + block.text;
							}
							if ( msg.channel.type === 'text' && msg.guild.id in patreons ) text += '\n\n<a:loading:641343250661113886> **' + lang.user.info.loading + '**';
						}
						
						msg.sendChannel( spoiler + text + spoiler, {embed} ).then( message => global_block(lang, message, username, text, embed, wiki, spoiler) );
					}
				}, error => {
					if ( rangeprefix && !username.includes( '/' ) ) username = rangeprefix;
					console.log( '- Error while getting the search results: ' + error );
					msg.sendChannelError( spoiler + '<' + wiki.toLink(namespace + username, querystring.toTitle(), fragment, body.query.general) + '>' + spoiler );
				} ).finally( () => {
					if ( reaction ) reaction.removeEmoji();
				} );
			}
		}, error => {
			console.log( '- Error while getting the search results: ' + error );
			msg.sendChannelError( spoiler + '<' + wiki.toLink(( querypage.noRedirect ? namespace : contribs ) + username, querystring.toTitle(), fragment) + '>' + spoiler );
			
			if ( reaction ) reaction.removeEmoji();
		} );
	} else {
		got.get( wiki + 'api.php?action=query&meta=allmessages|siteinfo&ammessages=custom-Wiki_Manager&amenableparser=true&siprop=general&list=users&usprop=blockinfo|groups|editcount|registration|gender&ususers=' + encodeURIComponent( username ) + '&format=json', {
			responseType: 'json'
		} ).then( response => {
			var body = response.body;
			if ( body && body.warnings ) log_warn(body.warnings);
			if ( response.statusCode !== 200 || !body || !body.query || !body.query.users ) {
				console.log( '- ' + response.statusCode + ': Error while getting the search results: ' + ( body && body.error && body.error.info ) );
				msg.sendChannelError( spoiler + '<' + wiki.toLink(namespace + username, querystring.toTitle(), fragment) + '>' + spoiler );
				
				if ( reaction ) reaction.removeEmoji();
			}
			else {
				var queryuser = body.query.users[0];
				if ( !queryuser ) {
					if ( querypage.missing !== undefined || querypage.ns === -1 ) {
						msg.reactEmoji('🤷');
						
						if ( reaction ) reaction.removeEmoji();
					}
					else {
						var pagelink = wiki.toLink(querypage.title, querystring.toTitle(), fragment, body.query.general);
						var embed = new Discord.MessageEmbed().setAuthor( body.query.general.sitename ).setTitle( querypage.title.escapeFormatting() ).setURL( pagelink );
						got.get( wiki.toDescLink(querypage.title) ).then( descresponse => {
							var descbody = descresponse.body;
							if ( descresponse.statusCode !== 200 || !descbody ) {
								console.log( '- ' + descresponse.statusCode + ': Error while getting the description.' );
							} else {
								var thumbnail = wiki.toLink('Special:FilePath/Wiki-wordmark.png', '', '', body.query.general);
								var parser = new htmlparser.Parser( {
									onopentag: (tagname, attribs) => {
										if ( tagname === 'meta' && attribs.property === 'og:description' ) {
											var description = attribs.content.escapeFormatting();
											if ( description.length > 2000 ) description = description.substring(0, 2000) + '\u2026';
											embed.setDescription( description );
										}
										if ( tagname === 'meta' && attribs.property === 'og:image' ) {
											thumbnail = attribs.content;
										}
									}
								}, {decodeEntities:true} );
								parser.write( descbody );
								parser.end();
								embed.setThumbnail( thumbnail );
							}
						}, error => {
							console.log( '- Error while getting the description: ' + error );
						} ).finally( () => {
							msg.sendChannel( spoiler + '<' + pagelink + '>' + spoiler, {embed} );
							
							if ( reaction ) reaction.removeEmoji();
						} );
					}
				}
				else {
					username = queryuser.name;
					var gender = [lang.user.info.gender];
					switch (queryuser.gender) {
						case 'male':
							gender.push(lang.user.gender.male);
							break;
						case 'female':
							gender.push(lang.user.gender.female);
							break;
						default: 
							gender.push(lang.user.gender.unknown);
					}
					var registration = [lang.user.info.registration, new Date(queryuser.registration).toLocaleString(lang.dateformat, timeoptions)];
					var editcount = [lang.user.info.editcount, queryuser.editcount];
					var groups = queryuser.groups;
					var group = [lang.user.info.group];
					var grouplist = lang.user.groups;
					for ( var i = 0; i < grouplist.length; i++ ) {
						if ( groups.includes( grouplist[i][0] ) && ( group.length === 1 || !['autoconfirmed', 'user'].includes( grouplist[i][0] ) ) ) {
							if ( grouplist[i][0] === 'wiki-manager' && body.query.allmessages[0]['*'] === username ) {
								group.push('**' + grouplist[i][1] + '**');
							}
							else group.push(grouplist[i][1]);
						}
					}
					var isBlocked = false;
					var blockexpiry = queryuser.blockexpiry;
					if ( blockexpiry === 'infinity' ) {
						blockexpiry = lang.user.block.until_infinity;
						isBlocked = true;
					} else if ( blockexpiry ) {
						var blockexpirydate = blockexpiry.replace( /(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2,3})/, '$1-$2-$3T$4:$5:$6Z' );
						blockexpiry = new Date(blockexpirydate).toLocaleString(lang.dateformat, timeoptions);
						if ( Date.parse(blockexpirydate) > Date.now() ) isBlocked = true;
					}
					var blockedby = '[[User:' + queryuser.blockedby + '|' + queryuser.blockedby + ']]';
					var blockreason = queryuser.blockreason;
					var block = {
						header: lang.user.block.header.replaceSave( '%s', username ).escapeFormatting(),
						text: lang.user.block['nofrom' + ( blockreason ? 'text' : 'noreason' )].replaceSave( '%2$s', blockexpiry ),
						by: blockedby,
						reason: blockreason
					};
					
					var pagelink = wiki.toLink(namespace + username, querystring.toTitle(), fragment, body.query.general);
					if ( msg.showEmbed() ) {
						var text = '<' + pagelink + '>';
						var embed = new Discord.MessageEmbed().setAuthor( body.query.general.sitename ).setTitle( username.escapeFormatting() ).setURL( pagelink ).addField( editcount[0], '[' + editcount[1] + '](' + wiki.toLink(contribs + username, '', '', body.query.general, true) + ')', true ).addField( group[0], group.slice(1).join(',\n'), true ).addField( gender[0], gender[1], true ).addField( registration[0], registration[1], true );
					}
					else {
						var embed = {};
						var text = '<' + pagelink + '>\n\n' + gender.join(' ') + '\n' + registration.join(' ') + '\n' + editcount.join(' ') + '\n' + group[0] + ' ' + group.slice(1).join(', ');
					}
					
					got.get( 'https://services.fandom.com/user-attribute/user/' + queryuser.userid + '?format=json&cache=' + Date.now(), {
						headers: {
							Accept: 'application/hal+json'
						},
						responseType: 'json'
					} ).then( presponse => {
						var pbody = presponse.body;
						if ( presponse.statusCode !== 200 || !pbody || pbody.title || !pbody._embedded || !pbody._embedded.properties ) {
							if ( !( pbody && pbody.status === 404 ) ) {
								console.log( '- ' + presponse.statusCode + ': Error while getting the user profile: ' + ( pbody && pbody.title ) );
							}
						}
						else {
							var profile = pbody._embedded.properties;
							var discordfield = profile.find( field => field.name === 'discordHandle' );
							var avatarfield = profile.find( field => field.name === 'avatar' );
							var biofield = profile.find( field => field.name === 'bio' );
							if ( discordfield && discordfield.value ) {
								discordfield.value = htmlToPlain( discordfield.value ).replace( /^\s*([^@#:]{2,32}?)\s*#(\d{4,6})\s*$/, '$1#$2' );
								if ( discordfield.value.length > 50 ) discordfield.value = discordfield.value.substring(0, 50) + '\u2026';
								if ( msg.channel.type === 'text' ) var discordmember = msg.guild.members.cache.find( member => {
									return member.user.tag.escapeFormatting() === discordfield.value;
								} );
								var discordname = [lang.user.info.discord,discordfield.value];
								if ( discordmember ) discordname[1] = discordmember.toString();
								
								if ( msg.showEmbed() ) embed.addField( discordname[0], discordname[1], true );
								else text += '\n' + discordname.join(' ');
							}
							if ( msg.showEmbed() ) {
								if ( avatarfield && avatarfield.value ) embed.setThumbnail( avatarfield.value );
								if ( biofield && biofield.value && !embed.description ) {
									var bio = biofield.value.escapeFormatting();
									if ( bio.length > 2000 ) bio = bio.substring(0, 2000) + '\u2026';
									embed.setDescription( bio );
								}
							}
						}
					}, error => {
						console.log( '- Error while getting the user profile: ' + error );
					} ).finally( () => {
						if ( msg.showEmbed() ) {
							if ( isBlocked ) {
								block.text = block.text.replaceSave( '%3$s', '[' + block.by.escapeFormatting() + '](' + wiki.toLink('User:' + block.by, '', '', body.query.general, true) + ')' );
								if ( block.reason ) block.text = block.text.replaceSave( '%4$s', block.reason.toMarkdown(wiki, body.query.general) );
								embed.addField( block.header, block.text );
							}
							if ( msg.channel.type === 'text' && msg.guild.id in patreons ) embed.addField( '\u200b', '<a:loading:641343250661113886> **' + lang.user.info.loading + '**' );
						}
						else {
							if ( isBlocked ) {
								block.text = block.text.replaceSave( '%3$s', block.by.escapeFormatting() );
								if ( block.reason ) block.text = block.text.replaceSave( '%4$s', block.reason.toPlaintext() );
								text += '\n\n**' + block.header + '**\n' + block.text;
							}
							if ( msg.channel.type === 'text' && msg.guild.id in patreons ) text += '\n\n<a:loading:641343250661113886> **' + lang.user.info.loading + '**';
						}
						
						msg.sendChannel( spoiler + text + spoiler, {embed} ).then( message => global_block(lang, message, username, text, embed, wiki, spoiler) );
						
						if ( reaction ) reaction.removeEmoji();
					} );
				}
			}
		}, error => {
			console.log( '- Error while getting the search results: ' + error );
			msg.sendChannelError( spoiler + '<' + wiki.toLink(namespace + username, querystring.toTitle(), fragment) + '>' + spoiler );
			
			if ( reaction ) reaction.removeEmoji();
		} );
	}
}

function global_block(lang, msg, username, text, embed, wiki, spoiler) {
	if ( !msg || msg.channel.type !== 'text' || !( msg.guild.id in patreons ) ) return;
	
	if ( msg.showEmbed() ) embed.fields.pop();
	else {
		let splittext = text.split('\n\n');
		splittext.pop();
		text = splittext.join('\n\n');
	}
	
	if ( wiki.isFandom() ) got.get( 'https://community.fandom.com/Special:Contributions/' + encodeURIComponent( username ) + '?limit=1' ).then( response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body ) {
			console.log( '- ' + response.statusCode + ': Error while getting the global block.' );
		}
		else {
			let $ = cheerio.load(body);
			if ( $('#mw-content-text .errorbox').length ) {
				if ( msg.showEmbed() ) embed.addField( lang.user.gblock.disabled, '\u200b' );
				else text += '\n\n**' + lang.user.gblock.disabled + '**';
			}
			else if ( $('.mw-warning-with-logexcerpt').length && !$(".mw-warning-with-logexcerpt .mw-logline-block").length ) {
				if ( msg.showEmbed() ) embed.addField( lang.user.gblock.header.replaceSave( '%s', username ).escapeFormatting(), '\u200b' );
				else text += '\n\n**' + lang.user.gblock.header.replaceSave( '%s', username ).escapeFormatting() + '**';
			}
		}
	}, error => {
		console.log( '- Error while getting the global block: ' + error );
	} ).finally( () => {
		if ( !/^(?:(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{2})?|(?:[\dA-F]{1,4}:){7}[\dA-F]{1,4}(?:\/\d{2,3})?)$/.test(username) ) {
			got.get( 'https://community.fandom.com/wiki/Special:Editcount/' + encodeURIComponent( username ) ).then( gresponse => {
				var gbody = gresponse.body;
				if ( gresponse.statusCode !== 200 || !gbody ) {
					console.log( '- ' + gresponse.statusCode + ': Error while getting the global edit count.' );
				}
				else {
					let $ = cheerio.load(gbody);
					var globaledits = $('#editcount .TablePager th').eq(7).text().replace( /[,\.]/g, '' );
					if ( globaledits ) {
						if ( msg.showEmbed() ) embed.spliceFields(1, 0, {name:lang.user.info.globaleditcount,value:'[' + globaledits + '](https://community.fandom.com/wiki/Special:Editcount/' + username.toTitle(true) + ')',inline:true});
						else {
							let splittext = text.split('\n');
							splittext.splice(5, 0, lang.user.info.globaleditcount + ' ' + globaledits);
							text = splittext.join('\n');
						}
					}
				}
			}, error => {
				console.log( '- Error while getting the global edit count: ' + error );
			} ).finally( () => {
				msg.edit( spoiler + text + spoiler, {embed,allowedMentions:{parse:[]}} ).catch(log_error);
			} );
		}
		else msg.edit( spoiler + text + spoiler, {embed,allowedMentions:{parse:[]}} ).catch(log_error);
	} );
	else if ( wiki.endsWith( '.gamepedia.com/' ) ) got.get( 'https://help.gamepedia.com/Special:GlobalBlockList/' + encodeURIComponent( username ) + '?uselang=qqx' ).then( response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body ) {
			console.log( '- ' + response.statusCode + ': Error while getting the global block.' );
		}
		else {
			let $ = cheerio.load(body);
			var gblock = $('.mw-blocklist');
			if ( gblock.length ) {
				var reason = gblock.find('.TablePager_col_reason').text().replace( /\)$/, '' ).split(', ');
				var timestamp = new Date(gblock.find('.TablePager_col_timestamp').text().replace( /(\d{2}:\d{2}), (\d{1,2}) \((\w+)\) (\d{4})/, '$3 $2, $4 $1 UTC' )).toLocaleString(lang.dateformat, timeoptions);
				var expiry = gblock.find('.TablePager_col_expiry').text();
				if ( expiry.startsWith( '(infiniteblock)' ) ) expiry = lang.user.block.until_infinity;
				else expiry = new Date(expiry.replace( /(\d{2}:\d{2}), (\d{1,2}) \((\w+)\) (\d{4})/, '$3 $2, $4 $1 UTC' )).toLocaleString(lang.dateformat, timeoptions);
				if ( msg.showEmbed() ) {
					var gblocktitle = lang.user.gblock.header.replaceSave( '%s', username ).escapeFormatting();
					var globalblock = embed.fields.find( field => field.inline === false && field.name === lang.user.block.header.replaceSave( '%s', username ).escapeFormatting() && field.value.replace( /\[([^\]]*)\]\([^\)]*\)/g, '$1' ) === lang.user.block[( reason.length > 4 ? 'text' : 'noreason' )].replaceSave( '%1$s', timestamp ).replaceSave( '%2$s', expiry ).replaceSave( '%3$s', reason[1].escapeFormatting() ).replaceSave( '%4$s', reason.slice(4).join(', ').escapeFormatting() ) );
					if ( globalblock ) globalblock.name = gblocktitle;
					else {
						var block_wiki = reason[3].replace( /Special:BlockList$/, '' );
						var gblocktext = lang.user.gblock[( reason.length > 4 ? 'text' : 'noreason' )].replaceSave( '%1$s', timestamp ).replaceSave( '%2$s', expiry ).replaceSave( '%3$s', '[' + reason[1] + '](' + block_wiki + 'User:' + reason[1].toTitle(true) + ')' ).replaceSave( '%4$s', '[' + reason[2] + '](' + block_wiki + 'Special:Contribs/' + username.toTitle(true) + ')' ).replaceSave( '%5$s', reason.slice(4).join(', ').escapeFormatting() );
						embed.addField( gblocktitle, gblocktext );
					}
				}
				else {
					let splittext = text.split('\n\n');
					var globalblock = splittext.indexOf('**' + lang.user.block.header.replaceSave( '%s', username ).escapeFormatting() + '**\n' + lang.user.block[( reason.length > 4 ? 'text' : 'noreason' )].replaceSave( '%1$s', timestamp ).replaceSave( '%2$s', expiry ).replaceSave( '%3$s', reason[1].escapeFormatting() ).replaceSave( '%4$s', reason.slice(4).join(', ').escapeFormatting() ));
					if ( globalblock !== -1 ) splittext[globalblock] = '**' + lang.user.gblock.header.replaceSave( '%s', username ).escapeFormatting() + '**\n' + lang.user.block[( reason.length > 4 ? 'text' : 'noreason' )].replaceSave( '%1$s', timestamp ).replaceSave( '%2$s', expiry ).replaceSave( '%3$s', reason[1].escapeFormatting() ).replaceSave( '%4$s', reason.slice(4).join(', ').escapeFormatting() );
					else splittext.push('**' + lang.user.gblock.header.replaceSave( '%s', username ).escapeFormatting() + '**\n' + lang.user.gblock[( reason.length > 4 ? 'text' : 'noreason' )].replaceSave( '%1$s', timestamp ).replaceSave( '%2$s', expiry ).replaceSave( '%3$s', reason[1].escapeFormatting() ).replaceSave( '%4$s', reason[2] ).replaceSave( '%5$s', reason.slice(4).join(', ').escapeFormatting() ));
					text = splittext.join('\n\n');
				}
			}
		}
	}, error => {
		console.log( '- Error while getting the global block: ' + error );
	} ).finally( () => {
		if ( !/^(?:(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{2})?|(?:[\dA-F]{1,4}:){7}[\dA-F]{1,4}(?:\/\d{2,3})?)$/.test(username) ) {
			got.get( 'https://help.gamepedia.com/UserProfile:' + encodeURIComponent( username ) ).then( gresponse => {
				var gbody = gresponse.body;
				if ( gresponse.statusCode !== 200 || !gbody ) {
					console.log( '- ' + gresponse.statusCode + ': Error while getting the global edit count.' );
				}
				else {
					let $ = cheerio.load(gbody);
					var wikisedited = $('.curseprofile .rightcolumn .section.stats dd').eq(0).text().replace( /[,\.]/g, '' );
					if ( wikisedited ) {
						if ( msg.showEmbed() ) embed.spliceFields(1, 0, {name:lang.user.info.wikisedited,value:wikisedited,inline:true});
						else {
							let splittext = text.split('\n');
							splittext.splice(5, 0, lang.user.info.wikisedited + ' ' + wikisedited);
							text = splittext.join('\n');
						}
					}
					var globaledits = $('.curseprofile .rightcolumn .section.stats dd').eq(2).text().replace( /[,\.]/g, '' );
					if ( globaledits ) {
						if ( msg.showEmbed() ) embed.spliceFields(1, 0, {name:lang.user.info.globaleditcount,value:'[' + globaledits + '](https://help.gamepedia.com/Gamepedia_Help_Wiki:Global_user_tracker#' + wiki.replace( /^https:\/\/([a-z\d-]{1,50})\.gamepedia\.com\/$/, '$1/' ) + username.toTitle(true) + ')',inline:true});
						else {
							let splittext = text.split('\n');
							splittext.splice(5, 0, lang.user.info.globaleditcount + ' ' + globaledits);
							text = splittext.join('\n');
						}
					}
				}
			}, error => {
				console.log( '- Error while getting the global edit count: ' + error );
			} ).finally( () => {
				msg.edit( spoiler + text + spoiler, {embed,allowedMentions:{parse:[]}} ).catch(log_error);
			} );
		}
		else msg.edit( spoiler + text + spoiler, {embed,allowedMentions:{parse:[]}} ).catch(log_error);
	} );
}

function fandom_discussion(lang, msg, wiki, title, query, reaction, spoiler) {
	if ( !title ) {
		var pagelink = wiki + 'f';
		var embed = new Discord.MessageEmbed().setAuthor( query.general.sitename ).setTitle( lang.discussion.main ).setURL( pagelink );
		got.get( wiki + 'f' ).then( descresponse => {
			var descbody = descresponse.body;
			if ( descresponse.statusCode !== 200 || !descbody ) {
				console.log( '- ' + descresponse.statusCode + ': Error while getting the description.' );
			} else {
				var thumbnail = wiki.toLink('Special:FilePath/Wiki-wordmark.png', '', '', query.general);
				var parser = new htmlparser.Parser( {
					onopentag: (tagname, attribs) => {
						if ( tagname === 'meta' && attribs.property === 'og:description' ) {
							var description = attribs.content.escapeFormatting();
							if ( description.length > 2000 ) description = description.substring(0, 2000) + '\u2026';
							embed.setDescription( description );
						}
						if ( tagname === 'meta' && attribs.property === 'og:image' ) {
							thumbnail = attribs.content;
						}
					}
				}, {decodeEntities:true} );
				parser.write( descbody );
				parser.end();
				embed.setThumbnail( thumbnail );
			}
		}, error => {
			console.log( '- Error while getting the description: ' + error );
		} ).finally( () => {
			msg.sendChannel( spoiler + '<' + pagelink + '>' + spoiler, {embed} );
			
			if ( reaction ) reaction.removeEmoji();
		} );
	}
	else if ( !query.wikidesc ) {
		return got.get( 'https://community.fandom.com/api/v1/Wikis/ByString?includeDomain=true&limit=10&string=' + query.general.servername + query.general.scriptpath + '&format=json', {
			responseType: 'json'
		} ).then( wvresponse => {
			var wvbody = wvresponse.body;
			if ( wvresponse.statusCode !== 200 || !wvbody || wvbody.exception || !wvbody.items || !wvbody.items.length ) {
				console.log( '- ' + wvresponse.statusCode + ': Error while getting the wiki id: ' + ( wvbody && wvbody.exception && wvbody.exception.details ) );
				msg.sendChannelError( spoiler + '<' + wiki + 'f' + '>' + spoiler );
				
				if ( reaction ) reaction.removeEmoji();
			}
			else if ( wvbody.items.some( site => site.domain === query.general.servername + query.general.scriptpath ) ) {
				query.wikidesc = {id: wvbody.items.find( site => site.domain === query.general.servername + query.general.scriptpath ).id};
				fandom_discussion(lang, msg, wiki, title, query, reaction, spoiler);
			}
			else {
				msg.sendChannelError( spoiler + '<' + wiki + 'f' + '>' + spoiler );
				
				if ( reaction ) reaction.removeEmoji();
			}
		}, error => {
			console.log( '- Error while getting the wiki id: ' + error );
			msg.sendChannelError( spoiler + '<' + wiki + 'f' + '>' + spoiler );
			
			if ( reaction ) reaction.removeEmoji();
		} );
	}
	else if ( title.split(' ')[0].toLowerCase() === 'post' || title.split(' ')[0].toLowerCase() === lang.discussion.post ) {
		title = title.split(' ').slice(1).join(' ');
		var limit = ( msg.channel.type === 'text' && msg.guild.id in patreons ? '100' : '50' );
		got.get( 'https://services.fandom.com/discussion/' + query.wikidesc.id + '/posts?limit=' + limit + '&format=json', {
			headers: {
				Accept: 'application/hal+json'
			},
			responseType: 'json'
		} ).then( response => {
			var body = response.body;
			if ( response.statusCode !== 200 || !body || body.title || !body._embedded || !body._embedded['doc:posts'] ) {
				console.log( '- ' + response.statusCode + ': Error while getting the posts: ' + ( body && body.title ) );
				msg.sendChannelError( spoiler + '<' + wiki + 'f' + '>' + spoiler );
				
				if ( reaction ) reaction.removeEmoji();
			}
			else if ( body._embedded['doc:posts'].length ) {
				var posts = body._embedded['doc:posts'];
				var embed = new Discord.MessageEmbed().setAuthor( query.general.sitename );
				
				if ( posts.some( post => post.id === title ) ) {
					fandom_discussionsend(lang, msg, wiki, posts.find( post => post.id === title ), embed, spoiler);
					
					if ( reaction ) reaction.removeEmoji();
				}
				else if ( /^\d+$/.test(title) ) {
					got.get( 'https://services.fandom.com/discussion/' + query.wikidesc.id + '/posts/' + title + '?format=json', {
						headers: {
							Accept: 'application/hal+json'
						},
						responseType: 'json'
					} ).then( presponse => {
						var pbody = presponse.body;
						if ( presponse.statusCode !== 200 || !pbody || pbody.id !== title ) {
							if ( pbody && pbody.title === 'The requested resource was not found.' ) {
								if ( posts.some( post => post.rawContent.toLowerCase().includes( title.toLowerCase() ) ) ) {
									fandom_discussionsend(lang, msg, wiki, posts.find( post => post.rawContent.toLowerCase().includes( title.toLowerCase() ) ), embed, spoiler);
								}
								else msg.reactEmoji('🤷');
							}
							else {
								console.log( '- ' + presponse.statusCode + ': Error while getting the post: ' + ( pbody && pbody.title ) );
								msg.sendChannelError( spoiler + '<' + wiki + 'f' + '>' + spoiler );
							}
							
							if ( reaction ) reaction.removeEmoji();
						}
						else if ( pbody.title ) {
							fandom_discussionsend(lang, msg, wiki, pbody, embed, spoiler);
							
							if ( reaction ) reaction.removeEmoji();
						}
						else got.get( 'https://services.fandom.com/discussion/' + query.wikidesc.id + '/threads/' + pbody.threadId + '?format=json', {
							headers: {
								Accept: 'application/hal+json'
							},
							responseType: 'json'
						} ).then( thresponse => {
							var thbody = thresponse.body;
							if ( thresponse.statusCode !== 200 || !thbody || thbody.id !== pbody.threadId ) {
								console.log( '- ' + thresponse.statusCode + ': Error while getting the thread: ' + ( thbody && thbody.title ) );
								embed.setTitle( '~~' + pbody.threadId + '~~' );
							}
							else embed.setTitle( thbody.title.escapeFormatting() );
						}, error => {
							console.log( '- Error while getting the thread: ' + error );
							embed.setTitle( '~~' + pbody.threadId + '~~' );
						} ).finally( () => {
							fandom_discussionsend(lang, msg, wiki, pbody, embed, spoiler);
							
							if ( reaction ) reaction.removeEmoji();
						} );
					}, error => {
						console.log( '- Error while getting the post: ' + error );
						msg.sendChannelError( spoiler + '<' + wiki + 'f' + '>' + spoiler );
						
						if ( reaction ) reaction.removeEmoji();
					} );
				}
				else if ( posts.some( post => post.rawContent.toLowerCase().includes( title.toLowerCase() ) ) ) {
					fandom_discussionsend(lang, msg, wiki, posts.find( post => post.rawContent.toLowerCase().includes( title.toLowerCase() ) ), embed, spoiler);
					
					if ( reaction ) reaction.removeEmoji();
				}
				else {
					msg.reactEmoji('🤷');
					
					if ( reaction ) reaction.removeEmoji();
				}
			}
			else {
				msg.reactEmoji('🤷');
				
				if ( reaction ) reaction.removeEmoji();
			}
		}, error => {
			console.log( '- Error while getting the posts: ' + error );
			msg.sendChannelError( spoiler + '<' + wiki + 'f' + '>' + spoiler );
			
			if ( reaction ) reaction.removeEmoji();
		} );
	}
	else {
		var limit = ( msg.channel.type === 'text' && msg.guild.id in patreons ? '100' : '50' );
		got.get( 'https://services.fandom.com/discussion/' + query.wikidesc.id + '/threads?sortKey=trending&limit=' + limit + '&format=json', {
			headers: {
				Accept: 'application/hal+json'
			},
			responseType: 'json'
		} ).then( response => {
			var body = response.body;
			if ( response.statusCode !== 200 || !body || body.title || !body._embedded || !body._embedded.threads ) {
				console.log( '- ' + response.statusCode + ': Error while getting the threads: ' + ( body && body.title ) );
				msg.sendChannelError( spoiler + '<' + wiki + 'f' + '>' + spoiler );
				
				if ( reaction ) reaction.removeEmoji();
			}
			else if ( body._embedded.threads.length ) {
				var threads = body._embedded.threads;
				var embed = new Discord.MessageEmbed().setAuthor( query.general.sitename );
				
				if ( threads.some( thread => thread.id === title ) ) {
					fandom_discussionsend(lang, msg, wiki, threads.find( thread => thread.id === title ), embed, spoiler);
					
					if ( reaction ) reaction.removeEmoji();
				}
				else if ( threads.some( thread => thread.title === title ) ) {
					fandom_discussionsend(lang, msg, wiki, threads.find( thread => thread.title === title ), embed, spoiler);
					
					if ( reaction ) reaction.removeEmoji();
				}
				else if ( threads.some( thread => thread.title.toLowerCase() === title.toLowerCase() ) ) {
					fandom_discussionsend(lang, msg, wiki, threads.find( thread => thread.title.toLowerCase() === title.toLowerCase() ), embed, spoiler);
					
					if ( reaction ) reaction.removeEmoji();
				}
				else if ( threads.some( thread => thread.title.includes( title ) ) ) {
					fandom_discussionsend(lang, msg, wiki, threads.find( thread => thread.title.includes( title ) ), embed, spoiler);
					
					if ( reaction ) reaction.removeEmoji();
				}
				else if ( threads.some( thread => thread.title.toLowerCase().includes( title.toLowerCase() ) ) ) {
					fandom_discussionsend(lang, msg, wiki, threads.find( thread => thread.title.toLowerCase().includes( title.toLowerCase() ) ), embed, spoiler);
					
					if ( reaction ) reaction.removeEmoji();
				}
				else if ( /^\d+$/.test(title) ) {
					got.get( 'https://services.fandom.com/discussion/' + query.wikidesc.id + '/threads/' + title + '?format=json', {
						headers: {
							Accept: 'application/hal+json'
						},
						responseType: 'json'
					} ).then( thresponse => {
						var thbody = thresponse.body;
						if ( thresponse.statusCode !== 200 || !thbody || thbody.id !== title ) {
							if ( thbody && thbody.status === 404 ) {
								if (threads.some( thread => thread.rawContent.toLowerCase().includes( title.toLowerCase() ) ) ) {
									fandom_discussionsend(lang, msg, wiki, threads.find( thread => thread.rawContent.toLowerCase().includes( title.toLowerCase() ) ), embed, spoiler);
								}
								else msg.reactEmoji('🤷');
							}
							else {
								console.log( '- ' + thresponse.statusCode + ': Error while getting the thread: ' + ( thbody && thbody.title ) );
								msg.sendChannelError( spoiler + '<' + wiki + 'f/p/' + title + '>' + spoiler );
							}
						}
						else fandom_discussionsend(lang, msg, wiki, thbody, embed, spoiler);
					}, error => {
						console.log( '- Error while getting the thread: ' + error );
						msg.sendChannelError( spoiler + '<' + wiki + 'f/p/' + title + '>' + spoiler );
					} ).finally( () => {
						if ( reaction ) reaction.removeEmoji();
					} );
				}
				else if ( threads.some( thread => thread.rawContent.toLowerCase().includes( title.toLowerCase() ) ) ) {
					fandom_discussionsend(lang, msg, wiki, threads.find( thread => thread.rawContent.toLowerCase().includes( title.toLowerCase() ) ), embed, spoiler);
					
					if ( reaction ) reaction.removeEmoji();
				}
				else {
					msg.reactEmoji('🤷');
					
					if ( reaction ) reaction.removeEmoji();
				}
			}
			else {
				msg.reactEmoji('🤷');
				
				if ( reaction ) reaction.removeEmoji();
			}
		}, error => {
			console.log( '- Error while getting the threads: ' + error );
			msg.sendChannelError( spoiler + '<' + wiki + 'f' + '>' + spoiler );
			
			if ( reaction ) reaction.removeEmoji();
		} );
	}
}

function fandom_discussionsend(lang, msg, wiki, discussion, embed, spoiler) {
	if ( discussion.title ) {
		embed.setTitle( discussion.title.escapeFormatting() );
		var pagelink = wiki + 'f/p/' + ( discussion.threadId || discussion.id );
	}
	else {
		if ( discussion._embedded.thread ) embed.setTitle( discussion._embedded.thread[0].title.escapeFormatting() );
		var pagelink = wiki + 'f/p/' + discussion.threadId + '/r/' + discussion.id;
	}
	var text = '<' + pagelink + '>';
	embed.setURL( pagelink ).setFooter( discussion.createdBy.name, discussion.createdBy.avatarUrl ).setTimestamp( discussion.creationDate.epochSecond * 1000 );
	var description = '';
	switch ( discussion.funnel ) {
		case 'IMAGE':
			embed.setImage( discussion._embedded.contentImages[0].url );
			break;
		case 'POLL':
			discussion.poll.answers.forEach( answer => embed.addField( answer.text.escapeFormatting(), ( answer.image ? '[__' + lang.discussion.image.escapeFormatting() + '__](' + answer.image.url + ')\n' : '' ) + ( lang.discussion.votes[answer.votes] || lang.discussion.votes['*' + answer.votes % 100] || lang.discussion.votes['*' + answer.votes % 10] || lang.discussion.votes.default ).replace( '%s', answer.votes ), true ) );
			break;
		case 'QUIZ':
			description = discussion.quiz.title.escapeFormatting();
			if ( discussion._embedded.openGraph ) embed.setThumbnail( discussion._embedded.openGraph[0].imageUrl );
			break;
		default:
			if ( discussion.jsonModel ) {
				try {
					description = discussion_formatting(JSON.parse(discussion.jsonModel)).replace( /(?:\*\*\*\*|(?<!\\)\_\_)/g, '' ).replace( /{@wiki}/g, wiki );
					if ( discussion._embedded.contentImages.length ) {
						if ( description.trim().endsWith( '{@0}' ) ) {
							embed.setImage( discussion._embedded.contentImages[0].url );
							description = description.replace( '{@0}', '' ).trim();
						}
						else {
							description = description.replace( /\{\@(\d+)\}/g, (match, n) => {
								if ( n >= discussion._embedded.contentImages.length ) return '';
								else return '[__' + lang.discussion.image.escapeFormatting() + '__](' + discussion._embedded.contentImages[n].url + ')';
							} );
							embed.setThumbnail( discussion._embedded.contentImages[0].url );
						}
					}
					else embed.setThumbnail( wiki.toLink('Special:FilePath/Wiki-wordmark.png') );
				}
				catch ( jsonerror ) {
					console.log( '- Error while getting the formatting: ' + jsonerror );
					description = discussion.rawContent.escapeFormatting();
					if ( discussion._embedded.contentImages.length ) embed.setThumbnail( discussion._embedded.contentImages[0].url );
				}
			}
			else if ( discussion.renderedContent ) {
				var current_tag = '';
				var parser = new htmlparser.Parser( {
					onopentag: (tagname, attribs) => {
						if ( tagname === 'a' ) {
							current_tag = attribs.href;
							description += '[';
						}
					},
					ontext: (htmltext) => {
						description += htmltext.escapeFormatting();
					},
					onclosetag: (tagname) => {
						if ( tagname === 'a' ) {
							description += '](' + current_tag + ')';
							current_tag = '';
						}
						if ( tagname === 'p' ) description += '\n';
					}
				}, {decodeEntities:true} );
				parser.write( discussion.renderedContent );
				parser.end();
				if ( discussion._embedded.contentImages.length ) embed.setThumbnail( discussion._embedded.contentImages[0].url );
			}
			else {
				description = discussion.rawContent.escapeFormatting();
				if ( discussion._embedded.contentImages.length ) embed.setThumbnail( discussion._embedded.contentImages[0].url );
			}
	}
	if ( description.length > 2000 ) description = description.substring(0, 2000) + '\u2026';
	embed.setDescription( description );
	
	msg.sendChannel( spoiler + text + spoiler, {embed} );
}

function gamepedia_diff(lang, msg, args, wiki, reaction, spoiler, embed) {
	if ( args[0] ) {
		var error = false;
		var title = '';
		var revision = 0;
		var diff = 0;
		var relative = 'prev';
		if ( /^\d+$/.test(args[0]) ) {
			revision = parseInt(args[0], 10);
			if ( args[1] ) {
				if ( /^\d+$/.test(args[1]) ) {
					diff = parseInt(args[1], 10);
				}
				else if ( args[1] === 'prev' || args[1] === 'next' || args[1] === 'cur' ) {
					relative = args[1];
				}
				else error = true;
			}
		}
		else if ( args[0] === 'prev' || args[0] === 'next' || args[0] === 'cur' ) {
			relative = args[0];
			if ( args[1] ) {
				if ( /^\d+$/.test(args[1]) ) {
					revision = parseInt(args[1], 10);
				}
				else error = true;
			}
			else error = true;
		}
		else title = args.join(' ');
		
		if ( error ) {
			msg.reactEmoji('error');
			if ( reaction ) reaction.removeEmoji();
		}
		else if ( diff ) {
			gamepedia_diffsend(lang, msg, [diff, revision], wiki, reaction, spoiler);
		}
		else {
			got.get( wiki + 'api.php?action=compare&prop=ids|diff' + ( title ? '&fromtitle=' + encodeURIComponent( title ) : '&fromrev=' + revision ) + '&torelative=' + relative + '&format=json', {
				responseType: 'json'
			} ).then( response => {
				var body = response.body;
				if ( body && body.warnings ) log_warn(body.warnings);
				if ( response.statusCode !== 200 || !body || !body.compare ) {
					var noerror = false;
					if ( body && body.error ) {
						switch ( body.error.code ) {
							case 'nosuchrevid':
								noerror = true;
								break;
							case 'missingtitle':
								noerror = true;
								break;
							case 'invalidtitle':
								noerror = true;
								break;
							case 'missingcontent':
								noerror = true;
								break;
							default:
								noerror = false;
						}
					}
					if ( wiki.noWiki(response.url) || response.statusCode === 410 ) {
						console.log( '- This wiki doesn\'t exist!' );
						msg.reactEmoji('nowiki');
					}
					else if ( noerror ) {
						msg.replyMsg( lang.diff.badrev );
					}
					else {
						console.log( '- ' + response.statusCode + ': Error while getting the search results: ' + ( body && body.error && body.error.info ) );
						msg.sendChannelError( spoiler + '<' + wiki.toLink(title, 'diff=' + relative + ( title ? '' : '&oldid=' + revision )) + '>' + spoiler );
					}
					
					if ( reaction ) reaction.removeEmoji();
				}
				else {
					if ( body.compare.fromarchive !== undefined || body.compare.toarchive !== undefined ) {
						msg.reactEmoji('error');
						
						if ( reaction ) reaction.removeEmoji();
					} else {
						var argids = [];
						var ids = body.compare;
						if ( ids.fromrevid && !ids.torevid ) argids = [ids.fromrevid];
						else if ( !ids.fromrevid && ids.torevid ) argids = [ids.torevid];
						else {
							argids = [ids.torevid, ids.fromrevid];
							var compare = ['', ''];
							if ( ids.fromtexthidden === undefined && ids.totexthidden === undefined && ids['*'] !== undefined ) {
								var more = '\n__' + lang.diff.info.more + '__';
								var current_tag = '';
								var small_prev_ins = '';
								var small_prev_del = '';
								var ins_length = more.length;
								var del_length = more.length;
								var added = false;
								var parser = new htmlparser.Parser( {
									onopentag: (tagname, attribs) => {
										if ( tagname === 'ins' || tagname == 'del' ) {
											current_tag = tagname;
										}
										if ( tagname === 'td' && attribs.class === 'diff-addedline' ) {
											current_tag = tagname+'a';
										}
										if ( tagname === 'td' && attribs.class === 'diff-deletedline' ) {
											current_tag = tagname+"d";
										}
										if ( tagname === 'td' && attribs.class === 'diff-marker' ) {
											added = true;
										}
									},
									ontext: (htmltext) => {
										if ( current_tag === 'ins' && ins_length <= 1000 ) {
											ins_length += ( '**' + htmltext.escapeFormatting() + '**' ).length;
											if ( ins_length <= 1000 ) small_prev_ins += '**' + htmltext.escapeFormatting() + '**';
											else small_prev_ins += more;
										}
										if ( current_tag === 'del' && del_length <= 1000 ) {
											del_length += ( '~~' + htmltext.escapeFormatting() + '~~' ).length;
											if ( del_length <= 1000 ) small_prev_del += '~~' + htmltext.escapeFormatting() + '~~';
											else small_prev_del += more;
										}
										if ( ( current_tag === 'afterins' || current_tag === 'tda') && ins_length <= 1000 ) {
											ins_length += htmltext.escapeFormatting().length;
											if ( ins_length <= 1000 ) small_prev_ins += htmltext.escapeFormatting();
											else small_prev_ins += more;
										}
										if ( ( current_tag === 'afterdel' || current_tag === 'tdd') && del_length <= 1000 ) {
											del_length += htmltext.escapeFormatting().length;
											if ( del_length <= 1000 ) small_prev_del += htmltext.escapeFormatting();
											else small_prev_del += more;
										}
										if ( added ) {
											if ( htmltext === '+' && ins_length <= 1000 ) {
												ins_length++;
												if ( ins_length <= 1000 ) small_prev_ins += '\n';
												else small_prev_ins += more;
											}
											if ( htmltext === '−' && del_length <= 1000 ) {
												del_length++;
												if ( del_length <= 1000 ) small_prev_del += '\n';
												else small_prev_del += more;
											}
											added = false;
										}
									},
									onclosetag: (tagname) => {
										if ( tagname === 'ins' ) {
											current_tag = 'afterins';
										} else if ( tagname === 'del' ) {
											current_tag = 'afterdel';
										} else {
											current_tag = '';
										}
									}
								}, {decodeEntities:true} );
								parser.write( ids['*'] );
								parser.end();
								if ( small_prev_del.length ) {
									if ( small_prev_del.replace( /\~\~/g, '' ).trim().length ) {
										compare[0] = small_prev_del.replace( /\~\~\~\~/g, '' );
									} else compare[0] = '__' + lang.diff.info.whitespace + '__';
								}
								if ( small_prev_ins.length ) {
									if ( small_prev_ins.replace( /\*\*/g, '' ).trim().length ) {
										compare[1] = small_prev_ins.replace( /\*\*\*\*/g, '' );
									} else compare[1] = '__' + lang.diff.info.whitespace + '__';
								}
							}
							else if ( ids.fromtexthidden !== undefined ) compare[0] = '__' + lang.diff.hidden + '__';
							else if ( ids.totexthidden !== undefined ) compare[1] = '__' + lang.diff.hidden + '__';
						}
						gamepedia_diffsend(lang, msg, argids, wiki, reaction, spoiler, compare);
					}
				}
			}, error => {
				if ( wiki.noWiki(error.message) ) {
					console.log( '- This wiki doesn\'t exist!' );
					msg.reactEmoji('nowiki');
				}
				else {
					console.log( '- Error while getting the search results: ' + error );
					msg.sendChannelError( spoiler + '<' + wiki.toLink(title, 'diff=' + relative + ( title ? '' : '&oldid=' + revision )) + '>' + spoiler );
				}
				
				if ( reaction ) reaction.removeEmoji();
			} );
		}
	}
	else {
		if ( embed ) msg.sendChannel( spoiler + '<' + embed.url + '>' + spoiler, {embed} );
		else msg.reactEmoji('error');
		
		if ( reaction ) reaction.removeEmoji();
	}
}

function gamepedia_diffsend(lang, msg, args, wiki, reaction, spoiler, compare) {
	got.get( wiki + 'api.php?action=query&meta=siteinfo&siprop=general&list=tags&tglimit=500&tgprop=displayname&prop=revisions&rvslots=main&rvprop=ids|timestamp|flags|user|size|comment|tags' + ( args.length === 1 || args[0] === args[1] ? '|content' : '' ) + '&revids=' + args.join('|') + '&format=json', {
		responseType: 'json'
	} ).then( response => {
		var body = response.body;
		if ( body && body.warnings ) log_warn(body.warnings);
		if ( response.statusCode !== 200 || !body || body.batchcomplete === undefined || !body.query ) {
			if ( wiki.noWiki(response.url) || response.statusCode === 410 ) {
				console.log( '- This wiki doesn\'t exist!' );
				msg.reactEmoji('nowiki');
			}
			else {
				console.log( '- ' + response.statusCode + ': Error while getting the search results: ' + ( body && body.error && body.error.info ) );
				msg.sendChannelError( spoiler + '<' + wiki.toLink('Special:Diff/' + ( args[1] ? args[1] + '/' : '' ) + args[0]) + '>' + spoiler );
			}
			
			if ( reaction ) reaction.removeEmoji();
		}
		else {
			if ( body.query.badrevids ) {
				msg.replyMsg( lang.diff.badrev );
				
				if ( reaction ) reaction.removeEmoji();
			}
			else if ( body.query.pages && !body.query.pages['-1'] ) {
				var pages = Object.values(body.query.pages);
				if ( pages.length !== 1 ) {
					msg.sendChannel( spoiler + '<' + wiki.toLink('Special:Diff/' + ( args[1] ? args[1] + '/' : '' ) + args[0], '', '', body.query.general) + '>' + spoiler );
					
					if ( reaction ) reaction.removeEmoji();
				}
				else {
					var title = pages[0].title;
					var revisions = pages[0].revisions.sort( (first, second) => Date.parse(second.timestamp) - Date.parse(first.timestamp) );
					var diff = revisions[0].revid;
					var oldid = ( revisions[1] ? revisions[1].revid : 0 );
					var editor = [lang.diff.info.editor, ( revisions[0].userhidden !== undefined ? lang.diff.hidden : revisions[0].user )];
					var timestamp = [lang.diff.info.timestamp, new Date(revisions[0].timestamp).toLocaleString(lang.dateformat, timeoptions)];
					var difference = revisions[0].size - ( revisions[1] ? revisions[1].size : 0 );
					var size = [lang.diff.info.size, lang.diff.info.bytes.replace( '%s', ( difference > 0 ? '+' : '' ) + difference )];
					var comment = [lang.diff.info.comment, ( revisions[0].commenthidden !== undefined ? lang.diff.hidden : ( revisions[0].comment ? revisions[0].comment.toFormatting(msg.showEmbed(), wiki, body.query.general, title) : lang.diff.nocomment ) )];
					if ( revisions[0].tags.length ) var tags = [lang.diff.info.tags, body.query.tags.filter( tag => revisions[0].tags.includes( tag.name ) ).map( tag => tag.displayname ).join(', ')];
					
					var pagelink = wiki.toLink(title, 'diff=' + diff + '&oldid=' + oldid, '', body.query.general);
					if ( msg.showEmbed() ) {
						var text = '<' + pagelink + '>';
						var editorlink = '[' + editor[1] + '](' + wiki.toLink('User:' + editor[1], '', '', body.query.general, true) + ')';
						if ( revisions[0].anon !== undefined ) {
							editorlink = '[' + editor[1] + '](' + wiki.toLink('Special:Contributions/' + editor[1], '', '', body.query.general, true) + ')';
						}
						if ( editor[1] === lang.diff.hidden ) editorlink = editor[1];
						var embed = new Discord.MessageEmbed().setAuthor( body.query.general.sitename ).setTitle( ( title + '?diff=' + diff + '&oldid=' + oldid ).escapeFormatting() ).setURL( pagelink ).addField( editor[0], editorlink, true ).addField( size[0], size[1], true ).addField( comment[0], comment[1] ).setFooter( timestamp[1] );
						if ( tags ) {
							var taglink = '';
							var tagtext = '';
							var tagparser = new htmlparser.Parser( {
								onopentag: (tagname, attribs) => {
									if ( tagname === 'a' ) taglink = attribs.href;
								},
								ontext: (htmltext) => {
									if ( taglink ) tagtext += '[' + htmltext.escapeFormatting() + '](' + taglink + ')'
									else tagtext += htmltext.escapeFormatting();
								},
								onclosetag: (tagname) => {
									if ( tagname === 'a' ) taglink = '';
								}
							}, {decodeEntities:true} );
							tagparser.write( tags[1] );
							tagparser.end();
							embed.addField( tags[0], tagtext );
						}
						
						var more = '\n__' + lang.diff.info.more + '__';
						if ( !compare && oldid ) got.get( wiki + 'api.php?action=compare&prop=diff&fromrev=' + oldid + '&torev=' + diff + '&format=json', {
							responseType: 'json'
						} ).then( cpresponse => {
							var cpbody = cpresponse.body;
							if ( cpbody && cpbody.warnings ) log_warn(cpbody.warnings);
							if ( cpresponse.statusCode !== 200 || !cpbody || !cpbody.compare || cpbody.compare['*'] === undefined ) {
								var noerror = false;
								if ( cpbody && cpbody.error ) {
									switch ( cpbody.error.code ) {
										case 'nosuchrevid':
											noerror = true;
											break;
										case 'missingcontent':
											noerror = true;
											break;
										default:
											noerror = false;
									}
								}
								if ( !noerror ) console.log( '- ' + cpresponse.statusCode + ': Error while getting the diff: ' + ( cpbody && cpbody.error && cpbody.error.info ) );
							}
							else if ( cpbody.compare.fromtexthidden === undefined && cpbody.compare.totexthidden === undefined && cpbody.compare.fromarchive === undefined && cpbody.compare.toarchive === undefined ) {
								var current_tag = '';
								var small_prev_ins = '';
								var small_prev_del = '';
								var ins_length = more.length;
								var del_length = more.length;
								var added = false;
								var parser = new htmlparser.Parser( {
									onopentag: (tagname, attribs) => {
										if ( tagname === 'ins' || tagname == 'del' ) {
											current_tag = tagname;
										}
										if ( tagname === 'td' && attribs.class === 'diff-addedline' ) {
											current_tag = tagname+'a';
										}
										if ( tagname === 'td' && attribs.class === 'diff-deletedline' ) {
											current_tag = tagname+"d";
										}
										if ( tagname === 'td' && attribs.class === 'diff-marker' ) {
											added = true;
										}
									},
									ontext: (htmltext) => {
										if ( current_tag === 'ins' && ins_length <= 1000 ) {
											ins_length += ( '**' + htmltext.escapeFormatting() + '**' ).length;
											if ( ins_length <= 1000 ) small_prev_ins += '**' + htmltext.escapeFormatting() + '**';
											else small_prev_ins += more;
										}
										if ( current_tag === 'del' && del_length <= 1000 ) {
											del_length += ( '~~' + htmltext.escapeFormatting() + '~~' ).length;
											if ( del_length <= 1000 ) small_prev_del += '~~' + htmltext.escapeFormatting() + '~~';
											else small_prev_del += more;
										}
										if ( ( current_tag === 'afterins' || current_tag === 'tda') && ins_length <= 1000 ) {
											ins_length += htmltext.escapeFormatting().length;
											if ( ins_length <= 1000 ) small_prev_ins += htmltext.escapeFormatting();
											else small_prev_ins += more;
										}
										if ( ( current_tag === 'afterdel' || current_tag === 'tdd') && del_length <= 1000 ) {
											del_length += htmltext.escapeFormatting().length;
											if ( del_length <= 1000 ) small_prev_del += htmltext.escapeFormatting();
											else small_prev_del += more;
										}
										if ( added ) {
											if ( htmltext === '+' && ins_length <= 1000 ) {
												ins_length++;
												if ( ins_length <= 1000 ) small_prev_ins += '\n';
												else small_prev_ins += more;
											}
											if ( htmltext === '−' && del_length <= 1000 ) {
												del_length++;
												if ( del_length <= 1000 ) small_prev_del += '\n';
												else small_prev_del += more;
											}
											added = false;
										}
									},
									onclosetag: (tagname) => {
										if ( tagname === 'ins' ) {
											current_tag = 'afterins';
										} else if ( tagname === 'del' ) {
											current_tag = 'afterdel';
										} else {
											current_tag = '';
										}
									}
								}, {decodeEntities:true} );
								parser.write( cpbody.compare['*'] );
								parser.end();
								if ( small_prev_del.length ) {
									if ( small_prev_del.replace( /\~\~/g, '' ).trim().length ) {
										embed.addField( lang.diff.info.removed, small_prev_del.replace( /\~\~\~\~/g, '' ), true );
									} else embed.addField( lang.diff.info.removed, '__' + lang.diff.info.whitespace + '__', true );
								}
								if ( small_prev_ins.length ) {
									if ( small_prev_ins.replace( /\*\*/g, '' ).trim().length ) {
										embed.addField( lang.diff.info.added, small_prev_ins.replace( /\*\*\*\*/g, '' ), true );
									} else embed.addField( lang.diff.info.added, '__' + lang.diff.info.whitespace + '__', true );
								}
							}
							else if ( cpbody.compare.fromtexthidden !== undefined ) {
								embed.addField( lang.diff.info.removed, '__' + lang.diff.hidden + '__', true );
							}
							else if ( cpbody.compare.totexthidden !== undefined ) {
								embed.addField( lang.diff.info.added, '__' + lang.diff.hidden + '__', true );
							}
						}, error => {
							console.log( '- Error while getting the diff: ' + error );
						} ).finally( () => {
							msg.sendChannel( spoiler + text + spoiler, {embed} );
							
							if ( reaction ) reaction.removeEmoji();
						} );
						else {
							if ( compare ) {
								if ( compare[0].length ) embed.addField( lang.diff.info.removed, compare[0], true );
								if ( compare[1].length ) embed.addField( lang.diff.info.added, compare[1], true );
							}
							else if ( revisions[0]['*'] ) {
								var content = revisions[0]['*'].escapeFormatting();
								if ( content.trim().length ) {
									if ( content.length <= 1000 ) content = '**' + content + '**';
									else {
										content = content.substring(0, 1000 - more.length);
										content = '**' + content.substring(0, content.lastIndexOf('\n')) + '**' + more;
									}
									embed.addField( lang.diff.info.added, content, true );
								} else embed.addField( lang.diff.info.added, '__' + lang.diff.info.whitespace + '__', true );
							}
							
							msg.sendChannel( spoiler + text + spoiler, {embed} );
							
							if ( reaction ) reaction.removeEmoji();
						}
					}
					else {
						var embed = {};
						var text = '<' + pagelink + '>\n\n' + editor.join(' ') + '\n' + timestamp.join(' ') + '\n' + size.join(' ') + '\n' + comment.join(' ');
						if ( tags ) text += htmlToPlain( '\n' + tags.join(' ') );
						
						msg.sendChannel( spoiler + text + spoiler, {embed} );
						
						if ( reaction ) reaction.removeEmoji();
					}
				}
			}
			else {
				msg.reactEmoji('error');
				
				if ( reaction ) reaction.removeEmoji();
			}
		}
	}, error => {
		if ( wiki.noWiki(error.message) ) {
			console.log( '- This wiki doesn\'t exist!' );
			msg.reactEmoji('nowiki');
		}
		else {
			console.log( '- Error while getting the search results: ' + error );
			msg.sendChannelError( spoiler + '<' + wiki.toLink('Special:Diff/' + ( args[1] ? args[1] + '/' : '' ) + args[0]) + '>' + spoiler );
		}
		
		if ( reaction ) reaction.removeEmoji();
	} );
}

function fandom_diff(lang, msg, args, wiki, reaction, spoiler, embed) {
	if ( args[0] ) {
		var error = false;
		var title = '';
		var revision = 0;
		var diff = 'prev';
		if ( /^\d+$/.test(args[0]) ) {
			revision = args[0];
			if ( args[1] ) {
				if ( /^\d+$/.test(args[1]) ) {
					diff = args[1];
				}
				else if ( args[1] === 'prev' || args[1] === 'next' ) {
					diff = args[1];
				}
				else error = true;
			}
		}
		else if ( args[0] === 'prev' || args[0] === 'next' ) {
			diff = args[0];
			if ( args[1] ) {
				if ( /^\d+$/.test(args[1]) ) {
					revision = args[1];
				}
				else error = true;
			}
			else error = true;
		}
		else title = args.join(' ');
		
		if ( error ) msg.reactEmoji('error');
		else if ( /^\d+$/.test(diff) ) {
			var argids = [];
			if ( parseInt(revision, 10) > parseInt(diff, 10) ) argids = [revision, diff];
			else if ( parseInt(revision, 10) === parseInt(diff, 10) ) argids = [revision];
			else argids = [diff, revision];
			fandom_diffsend(lang, msg, argids, wiki, reaction, spoiler);
		}
		else {
			got.get( wiki + 'api.php?action=query&prop=revisions&rvprop=' + ( title ? '&titles=' + encodeURIComponent( title ) : '&revids=' + revision ) + '&rvdiffto=' + diff + '&format=json', {
				responseType: 'json'
			} ).then( response => {
				var body = response.body;
				if ( body && body.warnings ) log_warn(body.warnings);
				if ( response.statusCode !== 200 || !body || !body.query ) {
					if ( wiki.noWiki(response.url) || response.statusCode === 410 ) {
						console.log( '- This wiki doesn\'t exist!' );
						msg.reactEmoji('nowiki');
					}
					else {
						console.log( '- ' + response.statusCode + ': Error while getting the search results: ' + ( body && body.error && body.error.info ) );
						msg.sendChannelError( spoiler + '<' + wiki.toLink(title, 'diff=' + diff + ( title ? '' : '&oldid=' + revision )) + '>' + spoiler );
					}
					
					if ( reaction ) reaction.removeEmoji();
				}
				else {
					if ( body.query.badrevids ) {
						msg.replyMsg( lang.diff.badrev );
						
						if ( reaction ) reaction.removeEmoji();
					} else if ( body.query.pages && !body.query.pages[-1] ) {
						var revisions = Object.values(body.query.pages)[0].revisions[0];
						if ( revisions.texthidden === undefined ) {
							var argids = [];
							var ids = revisions.diff;
							if ( !ids.from ) argids = [ids.to];
							else {
								argids = [ids.to, ids.from];
								var compare = ['', ''];
								if ( ids['*'] !== undefined ) {
									var more = '\n__' + lang.diff.info.more + '__';
									var current_tag = '';
									var small_prev_ins = '';
									var small_prev_del = '';
									var ins_length = more.length;
									var del_length = more.length;
									var added = false;
									var parser = new htmlparser.Parser( {
										onopentag: (tagname, attribs) => {
											if ( tagname === 'ins' || tagname == 'del' ) {
												current_tag = tagname;
											}
											if ( tagname === 'td' && attribs.class === 'diff-addedline' ) {
												current_tag = tagname+'a';
											}
											if ( tagname === 'td' && attribs.class === 'diff-deletedline' ) {
												current_tag = tagname+"d";
											}
											if ( tagname === 'td' && attribs.class === 'diff-marker' ) {
												added = true;
											}
										},
										ontext: (htmltext) => {
											if ( current_tag === 'ins' && ins_length <= 1000 ) {
												ins_length += ( '**' + htmltext.escapeFormatting() + '**' ).length;
												if ( ins_length <= 1000 ) small_prev_ins += '**' + htmltext.escapeFormatting() + '**';
												else small_prev_ins += more;
											}
											if ( current_tag === 'del' && del_length <= 1000 ) {
												del_length += ( '~~' + htmltext.escapeFormatting() + '~~' ).length;
												if ( del_length <= 1000 ) small_prev_del += '~~' + htmltext.escapeFormatting() + '~~';
												else small_prev_del += more;
											}
											if ( ( current_tag === 'afterins' || current_tag === 'tda') && ins_length <= 1000 ) {
												ins_length += htmltext.escapeFormatting().length;
												if ( ins_length <= 1000 ) small_prev_ins += htmltext.escapeFormatting();
												else small_prev_ins += more;
											}
											if ( ( current_tag === 'afterdel' || current_tag === 'tdd') && del_length <= 1000 ) {
												del_length += htmltext.escapeFormatting().length;
												if ( del_length <= 1000 ) small_prev_del += htmltext.escapeFormatting();
												else small_prev_del += more;
											}
											if ( added ) {
												if ( htmltext === '+' && ins_length <= 1000 ) {
													ins_length++;
													if ( ins_length <= 1000 ) small_prev_ins += '\n';
													else small_prev_ins += more;
												}
												if ( htmltext === '−' && del_length <= 1000 ) {
													del_length++;
													if ( del_length <= 1000 ) small_prev_del += '\n';
													else small_prev_del += more;
												}
												added = false;
											}
										},
										onclosetag: (tagname) => {
											if ( tagname === 'ins' ) {
												current_tag = 'afterins';
											} else if ( tagname === 'del' ) {
												current_tag = 'afterdel';
											} else {
												current_tag = '';
											}
										}
									}, {decodeEntities:true} );
									parser.write( ids['*'] );
									parser.end();
									if ( small_prev_del.length ) {
										if ( small_prev_del.replace( /\~\~/g, '' ).trim().length ) {
											compare[0] = small_prev_del.replace( /\~\~\~\~/g, '' );
										} else compare[0] = '__' + lang.diff.info.whitespace + '__';
									}
									if ( small_prev_ins.length ) {
										if ( small_prev_ins.replace( /\*\*/g, '' ).trim().length ) {
											compare[1] = small_prev_ins.replace( /\*\*\*\*/g, '' );
										} else compare[1] = '__' + lang.diff.info.whitespace + '__';
									}
								}
							}
							fandom_diffsend(lang, msg, argids, wiki, reaction, spoiler, compare);
						} else {
							msg.replyMsg( lang.diff.badrev );
							
							if ( reaction ) reaction.removeEmoji();
						}
					} else {
						if ( body.query.pages && body.query.pages[-1] ) msg.replyMsg( lang.diff.badrev );
						else msg.reactEmoji('error');
						
						if ( reaction ) reaction.removeEmoji();
					}
				}
			}, error => {
				if ( wiki.noWiki(error.message) ) {
					console.log( '- This wiki doesn\'t exist!' );
					msg.reactEmoji('nowiki');
				}
				else {
					console.log( '- Error while getting the search results: ' + error );
					msg.sendChannelError( spoiler + '<' + wiki.toLink(title, 'diff=' + diff + ( title ? '' : '&oldid=' + revision )) + '>' + spoiler );
				}
				
				if ( reaction ) reaction.removeEmoji();
			} );
		}
	}
	else {
		if ( embed ) msg.sendChannel( spoiler + '<' + embed.url + '>' + spoiler, {embed} );
		else msg.reactEmoji('error');
		
		if ( reaction ) reaction.removeEmoji();
	}
}

function fandom_diffsend(lang, msg, args, wiki, reaction, spoiler, compare) {
	got.get( wiki + 'api.php?action=query&meta=siteinfo&siprop=general&list=tags&tglimit=500&tgprop=displayname&prop=revisions&rvprop=ids|timestamp|flags|user|size|comment|tags' + ( args.length === 1 || args[0] === args[1] ? '|content' : '' ) + '&revids=' + args.join('|') + '&format=json', {
		responseType: 'json'
	} ).then( response => {
		var body = response.body;
		if ( body && body.warnings ) log_warn(body.warnings);
		if ( response.statusCode !== 200 || !body || !body.query ) {
			if ( wiki.noWiki(response.url) || response.statusCode === 410 ) {
				console.log( '- This wiki doesn\'t exist!' );
				msg.reactEmoji('nowiki');
			}
			else {
				console.log( '- ' + response.statusCode + ': Error while getting the search results: ' + ( body && body.error && body.error.info ) );
				msg.sendChannelError( spoiler + '<' + wiki.toLink('Special:Diff/' + ( args[1] ? args[1] + '/' : '' ) + args[0]) + '>' + spoiler );
			}
			
			if ( reaction ) reaction.removeEmoji();
		}
		else {
			if ( body.query.badrevids ) {
				msg.replyMsg( lang.diff.badrev );
				
				if ( reaction ) reaction.removeEmoji();
			}
			else if ( body.query.pages && !body.query.pages['-1'] ) {
				var pages = Object.values(body.query.pages);
				if ( pages.length !== 1 ) {
					msg.sendChannel( spoiler + '<' + wiki.toLink('Special:Diff/' + ( args[1] ? args[1] + '/' : '' ) + args[0], '', '', body.query.general) + '>' + spoiler );
					
					if ( reaction ) reaction.removeEmoji();
				}
				else {
					var title = pages[0].title;
					var revisions = pages[0].revisions.sort( (first, second) => Date.parse(second.timestamp) - Date.parse(first.timestamp) );
					var diff = revisions[0].revid;
					var oldid = ( revisions[1] ? revisions[1].revid : 0 );
					var editor = [lang.diff.info.editor, ( revisions[0].userhidden !== undefined ? lang.diff.hidden : revisions[0].user )];
					var timestamp = [lang.diff.info.timestamp, new Date(revisions[0].timestamp).toLocaleString(lang.dateformat, timeoptions)];
					var difference = revisions[0].size - ( revisions[1] ? revisions[1].size : 0 );
					var size = [lang.diff.info.size, lang.diff.info.bytes.replace( '%s', ( difference > 0 ? '+' : '' ) + difference )];
					var comment = [lang.diff.info.comment, ( revisions[0].commenthidden !== undefined ? lang.diff.hidden : ( revisions[0].comment ? revisions[0].comment.toFormatting(msg.showEmbed(), wiki, body.query.general, title) : lang.diff.nocomment ) )];
					if ( revisions[0].tags.length ) var tags = [lang.diff.info.tags, body.query.tags.filter( tag => revisions[0].tags.includes( tag.name ) ).map( tag => tag.displayname ).join(', ')];
					
					var pagelink = wiki.toLink(title, 'diff=' + diff + '&oldid=' + oldid, '', body.query.general);
					if ( msg.showEmbed() ) {
						var text = '<' + pagelink + '>';
						var editorlink = '[' + editor[1] + '](' + wiki.toLink('User:' + editor[1], '', '', body.query.general, true) + ')';
						if ( revisions[0].anon !== undefined ) {
							editorlink = '[' + editor[1] + '](' + wiki.toLink('Special:Contributions/' + editor[1], '', '', body.query.general, true) + ')';
						}
						if ( editor[1] === lang.diff.hidden ) editorlink = editor[1];
						var embed = new Discord.MessageEmbed().setAuthor( body.query.general.sitename ).setTitle( ( title + '?diff=' + diff + '&oldid=' + oldid ).escapeFormatting() ).setURL( pagelink ).addField( editor[0], editorlink, true ).addField( size[0], size[1], true ).addField( comment[0], comment[1] ).setFooter( timestamp[1] );
						if ( tags ) {
							var taglink = '';
							var tagtext = '';
							var tagparser = new htmlparser.Parser( {
								onopentag: (tagname, attribs) => {
									if ( tagname === 'a' ) taglink = attribs.href;
								},
								ontext: (htmltext) => {
									if ( taglink ) tagtext += '[' + htmltext.escapeFormatting() + '](' + taglink + ')'
									else tagtext += htmltext.escapeFormatting();
								},
								onclosetag: (tagname) => {
									if ( tagname === 'a' ) taglink = '';
								}
							}, {decodeEntities:true} );
							tagparser.write( tags[1] );
							tagparser.end();
							embed.addField( tags[0], tagtext );
						}
						
						var more = '\n__' + lang.diff.info.more + '__';
						if ( !compare && oldid ) got.get( wiki + 'api.php?action=query&prop=revisions&rvprop=&revids=' + oldid + '&rvdiffto=' + diff + '&format=json', {
							responseType: 'json'
						} ).then( cpresponse => {
							var cpbody = cpresponse.body;
							if ( cpbody && cpbody.warnings ) log_warn(cpbody.warnings);
							if ( cpresponse.statusCode !== 200 || !cpbody || !cpbody.query || cpbody.query.badrevids || !cpbody.query.pages && cpbody.query.pages[-1] ) {
								console.log( '- ' + cpresponse.statusCode + ': Error while getting the diff: ' + ( cpbody && cpbody.error && cpbody.error.info ) );
							}
							else {
								var revision = Object.values(cpbody.query.pages)[0].revisions[0];
								if ( revision.texthidden === undefined && revision.diff && revision.diff['*'] !== undefined ) {
									var current_tag = '';
									var small_prev_ins = '';
									var small_prev_del = '';
									var ins_length = more.length;
									var del_length = more.length;
									var added = false;
									var parser = new htmlparser.Parser( {
										onopentag: (tagname, attribs) => {
											if ( tagname === 'ins' || tagname == 'del' ) {
												current_tag = tagname;
											}
											if ( tagname === 'td' && attribs.class === 'diff-addedline' ) {
												current_tag = tagname+'a';
											}
											if ( tagname === 'td' && attribs.class === 'diff-deletedline' ) {
												current_tag = tagname+"d";
											}
											if ( tagname === 'td' && attribs.class === 'diff-marker' ) {
												added = true;
											}
										},
										ontext: (htmltext) => {
											if ( current_tag === 'ins' && ins_length <= 1000 ) {
												ins_length += ( '**' + htmltext.escapeFormatting() + '**' ).length;
												if ( ins_length <= 1000 ) small_prev_ins += '**' + htmltext.escapeFormatting() + '**';
												else small_prev_ins += more;
											}
											if ( current_tag === 'del' && del_length <= 1000 ) {
												del_length += ( '~~' + htmltext.escapeFormatting() + '~~' ).length;
												if ( del_length <= 1000 ) small_prev_del += '~~' + htmltext.escapeFormatting() + '~~';
												else small_prev_del += more;
											}
											if ( ( current_tag === 'afterins' || current_tag === 'tda') && ins_length <= 1000 ) {
												ins_length += htmltext.escapeFormatting().length;
												if ( ins_length <= 1000 ) small_prev_ins += htmltext.escapeFormatting();
												else small_prev_ins += more;
											}
											if ( ( current_tag === 'afterdel' || current_tag === 'tdd') && del_length <= 1000 ) {
												del_length += htmltext.escapeFormatting().length;
												if ( del_length <= 1000 ) small_prev_del += htmltext.escapeFormatting();
												else small_prev_del += more;
											}
											if ( added ) {
												if ( htmltext === '+' && ins_length <= 1000 ) {
													ins_length++;
													if ( ins_length <= 1000 ) small_prev_ins += '\n';
													else small_prev_ins += more;
												}
												if ( htmltext === '−' && del_length <= 1000 ) {
													del_length++;
													if ( del_length <= 1000 ) small_prev_del += '\n';
													else small_prev_del += more;
												}
												added = false;
											}
										},
										onclosetag: (tagname) => {
											if ( tagname === 'ins' ) {
												current_tag = 'afterins';
											} else if ( tagname === 'del' ) {
												current_tag = 'afterdel';
											} else {
												current_tag = '';
											}
										}
									}, {decodeEntities:true} );
									parser.write( revision.diff['*'] );
									parser.end();
									if ( small_prev_del.length ) {
										if ( small_prev_del.replace( /\~\~/g, '' ).trim().length ) {
											embed.addField( lang.diff.info.removed, small_prev_del.replace( /\~\~\~\~/g, '' ), true );
										} else embed.addField( lang.diff.info.removed, '__' + lang.diff.info.whitespace + '__', true );
									}
									if ( small_prev_ins.length ) {
										if ( small_prev_ins.replace( /\*\*/g, '' ).trim().length ) {
											embed.addField( lang.diff.info.added, small_prev_ins.replace( /\*\*\*\*/g, '' ), true );
										} else embed.addField( lang.diff.info.added, '__' + lang.diff.info.whitespace + '__', true );
									}
								}
								else if ( revision.texthidden !== undefined ) {
									embed.addField( lang.diff.info.added, '__' + lang.diff.hidden + '__', true );
								}
								else if ( revision.diff && revision.diff['*'] === undefined ) {
									embed.addField( lang.diff.info.removed, '__' + lang.diff.hidden + '__', true );
								}
							}
						}, error => {
							console.log( '- Error while getting the diff: ' + error );
						} ).finally( () => {
							msg.sendChannel( spoiler + text + spoiler, {embed} );
							
							if ( reaction ) reaction.removeEmoji();
						} );
						else {
							if ( compare ) {
								if ( compare[0].length ) embed.addField( lang.diff.info.removed, compare[0], true );
								if ( compare[1].length ) embed.addField( lang.diff.info.added, compare[1], true );
							}
							else if ( revisions[0]['*'] ) {
								var content = revisions[0]['*'].escapeFormatting();
								if ( content.trim().length ) {
									if ( content.length <= 1000 ) content = '**' + content + '**';
									else {
										content = content.substring(0, 1000 - more.length);
										content = '**' + content.substring(0, content.lastIndexOf('\n')) + '**' + more;
									}
									embed.addField( lang.diff.info.added, content, true );
								} else embed.addField( lang.diff.info.added, '__' + lang.diff.info.whitespace + '__', true );
							}
							
							msg.sendChannel( spoiler + text + spoiler, {embed} );
							
							if ( reaction ) reaction.removeEmoji();
						}
					}
					else {
						var embed = {};
						var text = '<' + pagelink + '>\n\n' + editor.join(' ') + '\n' + timestamp.join(' ') + '\n' + size.join(' ') + '\n' + comment.join(' ');
						if ( tags ) text += htmlToPlain( '\n' + tags.join(' ') );
						
						msg.sendChannel( spoiler + text + spoiler, {embed} );
						
						if ( reaction ) reaction.removeEmoji();
					}
				}
			}
			else {
				msg.reactEmoji('error');
				
				if ( reaction ) reaction.removeEmoji();
			}
		}
	}, error => {
		if ( wiki.noWiki(error.message) ) {
			console.log( '- This wiki doesn\'t exist!' );
			msg.reactEmoji('nowiki');
		}
		else {
			console.log( '- Error while getting the search results: ' + error );
			msg.sendChannelError( spoiler + '<' + wiki.toLink('Special:Diff/' + ( args[1] ? args[1] + '/' : '' ) + args[0]) + '>' + spoiler );
		}
		
		if ( reaction ) reaction.removeEmoji();
	} );
}

function gamepedia_random(lang, msg, wiki, reaction, spoiler) {
	got.get( wiki + 'api.php?action=query&meta=siteinfo&siprop=general&prop=pageimages|pageprops|extracts&piprop=original|name&ppprop=description|displaytitle&exsentences=10&exintro=true&explaintext=true&generator=random&grnnamespace=0&format=json', {
		responseType: 'json'
	} ).then( response => {
		var body = response.body;
		if ( body && body.warnings ) log_warn(body.warnings);
		if ( response.statusCode !== 200 || !body || body.batchcomplete === undefined || !body.query || !body.query.pages ) {
			if ( wiki.noWiki(response.url) || response.statusCode === 410 ) {
				console.log( '- This wiki doesn\'t exist!' );
				msg.reactEmoji('nowiki');
			}
			else {
				console.log( '- ' + response.statusCode + ': Error while getting the search results: ' + ( body && body.error && body.error.info ) );
				msg.sendChannelError( spoiler + '<' + wiki.toLink('Special:Random') + '>' + spoiler );
			}
		}
		else {
			var querypage = Object.values(body.query.pages)[0];
			var pagelink = wiki.toLink(querypage.title, '', '', body.query.general);
			var embed = new Discord.MessageEmbed().setAuthor( body.query.general.sitename ).setTitle( querypage.title.escapeFormatting() ).setURL( pagelink );
			if ( querypage.pageprops && querypage.pageprops.displaytitle ) {
				var displaytitle = htmlToDiscord( querypage.pageprops.displaytitle );
				if ( displaytitle.length > 250 ) displaytitle = displaytitle.substring(0, 250) + '\u2026';
				embed.setTitle( displaytitle );
			}
			if ( querypage.pageprops && querypage.pageprops.description ) {
				var description = htmlToPlain( querypage.pageprops.description );
				if ( description.length > 2000 ) description = description.substring(0, 2000) + '\u2026';
				embed.setDescription( description );
			}
			else if ( querypage.extract ) {
				var extract = querypage.extract.escapeFormatting();
				if ( extract.length > 2000 ) extract = extract.substring(0, 2000) + '\u2026';
				embed.setDescription( extract );
			}
			if ( querypage.pageimage && querypage.original && querypage.title !== body.query.general.mainpage ) {
				embed.setThumbnail( querypage.original.source );
			}
			else embed.setThumbnail( ( body.query.general.logo.startsWith( '//' ) ? 'https:' : '' ) + body.query.general.logo );
			
			msg.sendChannel( '🎲 ' + spoiler + '<' + pagelink + '>' + spoiler, {embed} );
		}
	}, error => {
		if ( wiki.noWiki(error.message) ) {
			console.log( '- This wiki doesn\'t exist!' );
			msg.reactEmoji('nowiki');
		}
		else {
			console.log( '- Error while getting the search results: ' + error );
			msg.sendChannelError( spoiler + '<' + wiki.toLink('Special:Random') + '>' + spoiler );
		}
	} ).finally( () => {
		if ( reaction ) reaction.removeEmoji();
	} );
}

function fandom_random(lang, msg, wiki, reaction, spoiler) {
	got.get( wiki + 'api.php?action=query&meta=allmessages|siteinfo&ammessages=description&siprop=general&generator=random&grnnamespace=0&format=json', {
		responseType: 'json'
	} ).then( response => {
		var body = response.body;
		if ( body && body.warnings ) log_warn(body.warnings);
		if ( response.statusCode !== 200 || !body || !body.query || !body.query.pages ) {
			if ( wiki.noWiki(response.url) || response.statusCode === 410 ) {
				console.log( '- This wiki doesn\'t exist!' );
				msg.reactEmoji('nowiki');
			}
			else {
				console.log( '- ' + response.statusCode + ': Error while getting the search results: ' + ( body && body.error && body.error.info ) );
				msg.sendChannelError( spoiler + '<' + wiki.toLink('Special:Random') + '>' + spoiler );
			}
			
			if ( reaction ) reaction.removeEmoji();
		}
		else if ( body.query.general.generator.startsWith( 'MediaWiki 1.3' ) ) {
			return gamepedia_random(lang, msg, wiki, reaction, spoiler);
		}
		else {
			var querypage = Object.values(body.query.pages)[0];
			var pagelink = wiki.toLink(querypage.title, '', '', body.query.general);
			var embed = new Discord.MessageEmbed().setAuthor( body.query.general.sitename ).setTitle( querypage.title.escapeFormatting() ).setURL( pagelink );
			if ( querypage.title === body.query.general.mainpage && body.query.allmessages[0]['*'] ) {
				embed.setDescription( body.query.allmessages[0]['*'] );
				embed.setThumbnail( wiki.toLink('Special:FilePath/Wiki-wordmark.png', '', '', body.query.general) );
				
				msg.sendChannel( spoiler + '<' + pagelink + '>' + spoiler, {embed} );
				
				if ( reaction ) reaction.removeEmoji();
			}
			else got.get( wiki.toDescLink(querypage.title) ).then( descresponse => {
				var descbody = descresponse.body;
				if ( descresponse.statusCode !== 200 || !descbody ) {
					console.log( '- ' + descresponse.statusCode + ': Error while getting the description.' );
				} else {
					var thumbnail = wiki.toLink('Special:FilePath/Wiki-wordmark.png', '', '', body.query.general);
					var parser = new htmlparser.Parser( {
						onopentag: (tagname, attribs) => {
							if ( tagname === 'meta' && attribs.property === 'og:description' ) {
								var description = attribs.content.escapeFormatting();
								if ( description.length > 2000 ) description = description.substring(0, 2000) + '\u2026';
								embed.setDescription( description );
							}
							if ( tagname === 'meta' && attribs.property === 'og:image' && querypage.title !== body.query.general.mainpage ) {
								thumbnail = attribs.content;
							}
						}
					}, {decodeEntities:true} );
					parser.write( descbody );
					parser.end();
					embed.setThumbnail( thumbnail );
				}
			}, error => {
				console.log( '- Error while getting the description: ' + error );
			} ).finally( () => {
				msg.sendChannel( '🎲 ' + spoiler + '<' + pagelink + '>' + spoiler, {embed} );
				
				if ( reaction ) reaction.removeEmoji();
			} );
		}
	}, error => {
		if ( wiki.noWiki(error.message) ) {
			console.log( '- This wiki doesn\'t exist!' );
			msg.reactEmoji('nowiki');
		}
		else {
			console.log( '- Error while getting the search results: ' + error );
			msg.sendChannelError( spoiler + '<' + wiki.toLink('Special:Random') + '>' + spoiler );
		}
		
		if ( reaction ) reaction.removeEmoji();
	} );
}

function gamepedia_overview(lang, msg, wiki, reaction, spoiler) {
	got.get( wiki + 'api.php?action=query&meta=allmessages|siteinfo&ammessages=custom-Wiki_Manager|custom-GamepediaNotice&amenableparser=true&siprop=general|statistics&titles=Special:Statistics&format=json', {
		responseType: 'json'
	} ).then( response => {
		var body = response.body;
		if ( body && body.warnings ) log_warn(body.warnings);
		if ( response.statusCode !== 200 || !body || body.batchcomplete === undefined || !body.query || !body.query.pages ) {
			if ( wiki.noWiki(response.url) || response.statusCode === 410 ) {
				console.log( '- This wiki doesn\'t exist!' );
				msg.reactEmoji('nowiki');
			}
			else {
				console.log( '- ' + response.statusCode + ': Error while getting the statistics: ' + ( body && body.error && body.error.info ) );
				msg.sendChannelError( spoiler + '<' + wiki.toLink('Special:Statistics') + '>' + spoiler );
			}
			
			if ( reaction ) reaction.removeEmoji();
		}
		else {
			var site = false;
			if ( allSites.some( site => site.wiki_domain === body.query.general.servername ) ) {
				site = allSites.find( site => site.wiki_domain === body.query.general.servername );
				
				var name = [lang.overview.name, site.wiki_display_name];
				var created = [lang.overview.created, new Date(parseInt(site.created + '000', 10)).toLocaleString(lang.dateformat, timeoptions)];
				var manager = [lang.overview.manager, site.wiki_managers];
				var official = [lang.overview.official, ( site.official_wiki ? lang.overview.yes : lang.overview.no )];
				var crossover = [lang.overview.crossover, ( site.wiki_crossover ? '<https://' + site.wiki_crossover + '/>' : '' )];
				var description = [lang.overview.description, site.wiki_description];
				var image = [lang.overview.image, site.wiki_image];
				
				if ( description[1] ) {
					description[1] = description[1].escapeFormatting();
					if ( description[1].length > 1000 ) description[1] = description[1].substring(0, 1000) + '\u2026';
				}
				if ( image[1] && image[1].startsWith( '/' ) ) image[1] = wiki.substring(0, wiki.length - 1) + image[1];
			}
			var articles = [lang.overview.articles, body.query.statistics.articles];
			var pages = [lang.overview.pages, body.query.statistics.pages];
			var edits = [lang.overview.edits, body.query.statistics.edits];
			var users = [lang.overview.users, body.query.statistics.activeusers];
			
			var title = body.query.pages['-1'].title;
			var pagelink = wiki.toLink(title, '', '', body.query.general);
			
			if ( msg.showEmbed() ) {
				var text = '<' + pagelink + '>';
				var embed = new Discord.MessageEmbed().setAuthor( body.query.general.sitename ).setTitle( title.escapeFormatting() ).setURL( pagelink ).setThumbnail( ( body.query.general.logo.startsWith( '//' ) ? 'https:' : '' ) + body.query.general.logo );
			}
			else {
				var embed = {};
				var text = '<' + pagelink + '>\n\n';
			}
			
			if ( wiki.isFandom() ) got.get( 'https://community.fandom.com/api/v1/Wikis/ByString?expand=true&includeDomain=true&limit=10&string=' + body.query.general.servername + body.query.general.scriptpath + '&format=json', {
				responseType: 'json'
			} ).then( ovresponse => {
				var ovbody = ovresponse.body;
				if ( ovresponse.statusCode !== 200 || !ovbody || ovbody.exception || !ovbody.items || !ovbody.items.length ) {
					console.log( '- ' + ovresponse.statusCode + ': Error while getting the wiki details: ' + ( ovbody && ovbody.exception && ovbody.exception.details ) );
					msg.sendChannelError( spoiler + '<' + wiki.toLink('Special:Statistics', '', '', body.query.general) + '>' + spoiler );
					
					if ( reaction ) reaction.removeEmoji();
				}
				else if ( ovbody.items.some( site => site.url === body.query.general.server + ( body.query.general.scriptpath ? body.query.general.scriptpath + '/' : '' ) ) ) {
					site = ovbody.items.find( site => site.url === body.query.general.server + ( body.query.general.scriptpath ? body.query.general.scriptpath + '/' : '' ) );
					
					var vertical = [lang.overview.vertical, site.hub];
					var topic = [lang.overview.topic, site.topic];
					var founder = [lang.overview.founder, site.founding_user_id];
					var manager = [lang.overview.manager, body.query.allmessages[0]['*']];
					var crossover = [lang.overview.crossover, ( body.query.allmessages[1]['*'] ? '<https://' + body.query.allmessages[1]['*'] + '.gamepedia.com/>' : '' )];
					var created = [lang.overview.created, new Date(site.creation_date).toLocaleString(lang.dateformat, timeoptions)];
					var description = [lang.overview.description, site.desc];
					var image = [lang.overview.image, site.image];
					
					if ( description[1] ) {
						description[1] = description[1].escapeFormatting();
						if ( description[1].length > 1000 ) description[1] = description[1].substring(0, 1000) + '\u2026';
					}
					if ( image[1] && image[1].startsWith( '/' ) ) image[1] = wiki.substring(0, wiki.length - 1) + image[1];
					
					if ( msg.showEmbed() ) {
						embed.addField( vertical[0], vertical[1], true );
						if ( topic[1] ) embed.addField( topic[0], topic[1], true );
					}
					else text += vertical.join(' ') + ( topic[1] ? '\n' + topic.join(' ') : '' );
					
					if ( founder[1] > 0 ) got.get( wiki + 'api.php?action=query&list=users&usprop=&ususerids=' + founder[1] + '&format=json', {
						responseType: 'json'
					} ).then( usresponse => {
						var usbody = usresponse.body;
						if ( usbody && usbody.warnings ) log_warn(usbody.warnings);
						if ( usresponse.statusCode !== 200 || !usbody || !usbody.query || !usbody.query.users || !usbody.query.users[0] ) {
							console.log( '- ' + usresponse.statusCode + ': Error while getting the wiki founder: ' + ( usbody && usbody.error && usbody.error.info ) );
							founder[1] = 'ID: ' + founder[1];
						}
						else {
							var user = usbody.query.users[0].name;
							if ( msg.showEmbed() ) founder[1] = '[' + user + '](' + wiki.toLink('User:' + user, '', '', body.query.general, true) + ')';
							else founder[1] = user;
						}
					}, error => {
						console.log( '- Error while getting the wiki founder: ' + error );
						founder[1] = 'ID: ' + founder[1];
					} ).finally( () => {
						if ( msg.showEmbed() ) {
							embed.addField( founder[0], founder[1], true );
							if ( manager[1] ) embed.addField( manager[0], '[' + manager[1] + '](' + wiki.toLink('User:' + manager[1], '', '', body.query.general, true) + ') ([' + lang.overview.talk + '](' + wiki.toLink('User talk:' + manager[1], '', '', body.query.general, true) + '))', true );
							embed.addField( created[0], created[1], true ).addField( articles[0], articles[1], true ).addField( pages[0], pages[1], true ).addField( edits[0], edits[1], true ).addField( users[0], users[1], true ).setFooter( lang.overview.inaccurate );
							if ( crossover[1] ) {
								var crossoverSite = allSites.find( site => '<https://' + site.wiki_domain + '/>' === crossover[1] );
								if ( crossoverSite ) embed.addField( crossover[0], '[' + crossoverSite.wiki_display_name + '](' + crossover[1] + ')', true );
								else embed.addField( crossover[0], crossover[1], true );
							}
							if ( description[1] ) embed.addField( description[0], description[1] );
							if ( image[1] ) embed.addField( image[0], image[1] ).setImage( image[1] );
						}
						else {
							text += '\n' + founder.join(' ') + ( manager[1] ? '\n' + manager.join(' ') : '' ) + '\n' + created.join(' ') + '\n' + articles.join(' ') + '\n' + pages.join(' ') + '\n' + edits.join(' ') + '\n' + users.join(' ');
							if ( crossover[1] ) text += '\n' + crossover.join(' ');
							if ( description[1] ) text += '\n' + description.join(' ');
							if ( image[1] ) {
								text += '\n' + image.join(' ');
								if ( msg.uploadFiles() ) embed.files = [image[1]];
							}
							text += '\n\n*' + lang.overview.inaccurate + '*';
						}
						
						msg.sendChannel( spoiler + text + spoiler, {embed} );
						
						if ( reaction ) reaction.removeEmoji();
					} );
					else {
						founder[1] = lang.overview.none;
						if ( msg.showEmbed() ) {
							embed.addField( founder[0], founder[1], true ).addField( created[0], created[1], true ).addField( articles[0], articles[1], true ).addField( pages[0], pages[1], true ).addField( edits[0], edits[1], true ).addField( users[0], users[1], true ).setFooter( lang.overview.inaccurate );
							if ( crossover[1] ) {
								var crossoverSite = allSites.find( site => '<https://' + site.wiki_domain + '/>' === crossover[1] );
								if ( crossoverSite ) embed.addField( crossover[0], '[' + crossoverSite.wiki_display_name + '](' + crossover[1] + ')', true );
								else embed.addField( crossover[0], crossover[1], true );
							}
							if ( description[1] ) embed.addField( description[0], description[1] );
							if ( image[1] ) embed.addField( image[0], image[1] ).setImage( image[1] );
						}
						else {
							text += '\n' + founder.join(' ') + '\n' + created.join(' ') + '\n' + articles.join(' ') + '\n' + pages.join(' ') + '\n' + edits.join(' ') + '\n' + users.join(' ');
							if ( crossover[1] ) text += '\n' + crossover.join(' ');
							if ( description[1] ) text += '\n' + description.join(' ');
							if ( image[1] ) {
								text += '\n' + image.join(' ');
								if ( msg.uploadFiles() ) embed.files = [image[1]];
							}
							text += '\n\n*' + lang.overview.inaccurate + '*';
						}
						
						msg.sendChannel( spoiler + text + spoiler, {embed} );
						
						if ( reaction ) reaction.removeEmoji();
					}
				}
				else {
					if ( msg.showEmbed() ) embed.addField( articles[0], articles[1], true ).addField( pages[0], pages[1], true ).addField( edits[0], edits[1], true ).addField( users[0], users[1], true ).setTimestamp( client.readyTimestamp ).setFooter( lang.overview.inaccurate );
					else text = articles.join(' ') + '\n' + pages.join(' ') + '\n' + edits.join(' ') + '\n' + users.join(' ') + '\n\n*' + lang.overview.inaccurate + '*';
					
					msg.sendChannel( spoiler + text + spoiler, {embed} );
					
					if ( reaction ) reaction.removeEmoji();
				}
			}, error => {
				console.log( '- Error while getting the wiki details: ' + error );
				msg.sendChannelError( spoiler + '<' + wiki.toLink('Special:Statistics', '', '', body.query.general) + '>' + spoiler );
				
				if ( reaction ) reaction.removeEmoji();
			} );
			else {
				if ( msg.showEmbed() ) {
					if ( site ) {
						var managerlist = manager[1].map( wm => '[' + wm + '](' + wiki.toLink('User:' + wm, '', '', body.query.general, true) + ') ([' + lang.overview.talk + '](' + wiki.toLink('User talk:' + wm, '', '', body.query.general, true) + '))' ).join('\n');
						embed.addField( name[0], name[1], true ).addField( created[0], created[1], true ).addField( manager[0], ( managerlist || lang.overview.none ), true ).addField( official[0], official[1], true );
					}
					embed.addField( articles[0], articles[1], true ).addField( pages[0], pages[1], true ).addField( edits[0], edits[1], true ).addField( users[0], users[1], true ).setTimestamp( client.readyTimestamp ).setFooter( lang.overview.inaccurate );
					if ( site ) {
						if ( crossover[1] ) embed.addField( crossover[0], crossover[1], true );
						if ( description[1] ) embed.addField( description[0], description[1] );
						if ( image[1] ) embed.addField( image[0], image[1] ).setImage( image[1] );
					}
				}
				else {
					if ( site ) text += name.join(' ') + '\n' + created.join(' ') + '\n' + manager[0] + ' ' + ( manager[1].join(', ') || lang.overview.none ) + '\n' + official.join(' ') + '\n';
					text += articles.join(' ') + '\n' + pages.join(' ') + '\n' + edits.join(' ') + '\n' + users.join(' ');
					if ( site ) {
						if ( crossover[1] ) text += '\n' + crossover.join(' ');
						if ( description[1] ) text += '\n' + description.join(' ');
						if ( image[1] ) {
							text += '\n' + image.join(' ');
							if ( msg.uploadFiles() ) embed.files = [{attachment:image[1],name:( spoiler ? 'SPOILER ' : '' ) + name[1] + image[1].substring(image[1].lastIndexOf('.'))}];
						}
					}
					text += '\n\n*' + lang.overview.inaccurate + '*';
				}
				
				msg.sendChannel( spoiler + text + spoiler, {embed} );
				
				if ( reaction ) reaction.removeEmoji();
			}
		}
	}, error => {
		if ( wiki.noWiki(error.message) ) {
			console.log( '- This wiki doesn\'t exist!' );
			msg.reactEmoji('nowiki');
		}
		else {
			console.log( '- Error while getting the statistics: ' + error );
			msg.sendChannelError( spoiler + '<' + wiki.toLink('Special:Statistics') + '>' + spoiler );
		}
		
		if ( reaction ) reaction.removeEmoji();
	} );
}

function fandom_overview(lang, msg, wiki, reaction, spoiler) {
	got.get( wiki + 'api.php?action=query&meta=allmessages|siteinfo&ammessages=custom-Wiki_Manager|custom-GamepediaNotice&amenableparser=true&siprop=general|statistics|wikidesc&titles=Special:Statistics&format=json', {
		responseType: 'json'
	} ).then( response => {
		var body = response.body;
		if ( body && body.warnings ) log_warn(body.warnings);
		if ( response.statusCode !== 200 || !body || !body.query || !body.query.pages ) {
			if ( wiki.noWiki(response.url) || response.statusCode === 410 ) {
				console.log( '- This wiki doesn\'t exist!' );
				msg.reactEmoji('nowiki');
			}
			else {
				console.log( '- ' + response.statusCode + ': Error while getting the statistics: ' + ( body && body.error && body.error.info ) );
				msg.sendChannelError( spoiler + '<' + wiki.toLink('Special:Statistics') + '>' + spoiler );
			}
			
			if ( reaction ) reaction.removeEmoji();
		}
		else if ( body.query.general.generator.startsWith( 'MediaWiki 1.3' ) ) {
			return gamepedia_overview(lang, msg, wiki, reaction, spoiler);
		}
		else got.get( 'https://community.fandom.com/api/v1/Wikis/Details?ids=' + body.query.wikidesc.id + '&format=json', {
			responseType: 'json'
		} ).then( ovresponse => {
			var ovbody = ovresponse.body;
			if ( ovresponse.statusCode !== 200 || !ovbody || ovbody.exception || !ovbody.items || !ovbody.items[body.query.wikidesc.id] ) {
				console.log( '- ' + ovresponse.statusCode + ': Error while getting the wiki details: ' + ( ovbody && ovbody.exception && ovbody.exception.details ) );
				msg.sendChannelError( spoiler + '<' + wiki.toLink('Special:Statistics', '', '', body.query.general) + '>' + spoiler );
				
				if ( reaction ) reaction.removeEmoji();
			}
			else {
				var site = ovbody.items[body.query.wikidesc.id];
				
				var vertical = [lang.overview.vertical, site.hub];
				var topic = [lang.overview.topic, site.topic];
				var founder = [lang.overview.founder, site.founding_user_id];
				var manager = [lang.overview.manager, body.query.allmessages[0]['*']];
				var crossover = [lang.overview.crossover, ( body.query.allmessages[1]['*'] ? '<https://' + body.query.allmessages[1]['*'] + '.gamepedia.com/>' : '' )];
				var created = [lang.overview.created, new Date(site.creation_date).toLocaleString(lang.dateformat, timeoptions)];
				var articles = [lang.overview.articles, body.query.statistics.articles];
				var pages = [lang.overview.pages, body.query.statistics.pages];
				var edits = [lang.overview.edits, body.query.statistics.edits];
				var users = [lang.overview.users, body.query.statistics.activeusers];
				var description = [lang.overview.description, site.desc];
				var image = [lang.overview.image, site.image];
				
				if ( description[1] ) {
					description[1] = description[1].escapeFormatting();
					if ( description[1].length > 1000 ) description[1] = description[1].substring(0, 1000) + '\u2026';
				}
				if ( image[1] && image[1].startsWith( '/' ) ) image[1] = wiki.substring(0, wiki.length - 1) + image[1];
				
				var title = body.query.pages['-1'].title;
				var pagelink = wiki.toLink(title, '', '', body.query.general);
				if ( msg.showEmbed() ) {
					var text = '<' + pagelink + '>';
					var embed = new Discord.MessageEmbed().setAuthor( body.query.general.sitename ).setTitle( title.escapeFormatting() ).setURL( pagelink ).setThumbnail( site.wordmark ).addField( vertical[0], vertical[1], true );
					if ( topic[1] ) embed.addField( topic[0], topic[1], true );
				}
				else {
					var embed = {};
					var text = '<' + pagelink + '>\n\n' + vertical.join(' ') + ( topic[1] ? '\n' + topic.join(' ') : '' );
				}
				
				if ( founder[1] > 0 ) got.get( wiki + 'api.php?action=query&list=users&usprop=&usids=' + founder[1] + '&format=json', {
					responseType: 'json'
				} ).then( usresponse => {
					var usbody = usresponse.body;
					if ( usbody && usbody.warnings ) log_warn(usbody.warnings);
					if ( usresponse.statusCode !== 200 || !usbody || !usbody.query || !usbody.query.users || !usbody.query.users[0] ) {
						console.log( '- ' + usresponse.statusCode + ': Error while getting the wiki founder: ' + ( usbody && usbody.error && usbody.error.info ) );
						founder[1] = 'ID: ' + founder[1];
					}
					else {
						var user = usbody.query.users[0].name;
						if ( msg.showEmbed() ) founder[1] = '[' + user + '](' + wiki.toLink('User:' + user, '', '', body.query.general, true) + ')';
						else founder[1] = user;
					}
				}, error => {
					console.log( '- Error while getting the wiki founder: ' + error );
					founder[1] = 'ID: ' + founder[1];
				} ).finally( () => {
					if ( msg.showEmbed() ) {
						embed.addField( founder[0], founder[1], true );
						if ( manager[1] ) embed.addField( manager[0], '[' + manager[1] + '](' + wiki.toLink('User:' + manager[1], '', '', body.query.general, true) + ') ([' + lang.overview.talk + '](' + wiki.toLink('User talk:' + manager[1], '', '', body.query.general, true) + '))', true );
						embed.addField( created[0], created[1], true ).addField( articles[0], articles[1], true ).addField( pages[0], pages[1], true ).addField( edits[0], edits[1], true ).addField( users[0], users[1], true ).setFooter( lang.overview.inaccurate );
						if ( crossover[1] ) {
							var crossoverSite = allSites.find( site => '<https://' + site.wiki_domain + '/>' === crossover[1] );
							if ( crossoverSite ) embed.addField( crossover[0], '[' + crossoverSite.wiki_display_name + '](' + crossover[1] + ')', true );
							else embed.addField( crossover[0], crossover[1], true );
						}
						if ( description[1] ) embed.addField( description[0], description[1] );
						if ( image[1] ) embed.addField( image[0], image[1] ).setImage( image[1] );
					}
					else {
						text += '\n' + founder.join(' ') + ( manager[1] ? '\n' + manager.join(' ') : '' ) + '\n' + created.join(' ') + '\n' + articles.join(' ') + '\n' + pages.join(' ') + '\n' + edits.join(' ') + '\n' + users.join(' ');
						if ( crossover[1] ) text += '\n' + crossover.join(' ');
						if ( description[1] ) text += '\n' + description.join(' ');
						if ( image[1] ) {
							text += '\n' + image.join(' ');
							if ( msg.uploadFiles() ) embed.files = [image[1]];
						}
						text += '\n\n*' + lang.overview.inaccurate + '*';
					}
					
					msg.sendChannel( spoiler + text + spoiler, {embed} );
					
					if ( reaction ) reaction.removeEmoji();
				} );
				else {
					founder[1] = lang.overview.none;
					if ( msg.showEmbed() ) {
						embed.addField( founder[0], founder[1], true ).addField( created[0], created[1], true ).addField( articles[0], articles[1], true ).addField( pages[0], pages[1], true ).addField( edits[0], edits[1], true ).addField( users[0], users[1], true ).setFooter( lang.overview.inaccurate );
						if ( crossover[1] ) {
							var crossoverSite = allSites.find( site => '<https://' + site.wiki_domain + '/>' === crossover[1] );
							if ( crossoverSite ) embed.addField( crossover[0], '[' + crossoverSite.wiki_display_name + '](' + crossover[1] + ')', true );
							else embed.addField( crossover[0], crossover[1], true );
						}
						if ( description[1] ) embed.addField( description[0], description[1] );
						if ( image[1] ) embed.addField( image[0], image[1] ).setImage( image[1] );
					}
					else {
						text += '\n' + founder.join(' ') + '\n' + created.join(' ') + '\n' + articles.join(' ') + '\n' + pages.join(' ') + '\n' + edits.join(' ') + '\n' + users.join(' ');
						if ( crossover[1] ) text += '\n' + crossover.join(' ');
						if ( description[1] ) text += '\n' + description.join(' ');
						if ( image[1] ) {
							text += '\n' + image.join(' ');
							if ( msg.uploadFiles() ) embed.files = [image[1]];
						}
						text += '\n\n*' + lang.overview.inaccurate + '*';
					}
					
					msg.sendChannel( spoiler + text + spoiler, {embed} );
					
					if ( reaction ) reaction.removeEmoji();
				}
			}
		}, error => {
			console.log( '- Error while getting the wiki details: ' + error );
			msg.sendChannelError( spoiler + '<' + wiki.toLink('Special:Statistics', '', '', body.query.general) + '>' + spoiler );
			
			if ( reaction ) reaction.removeEmoji();
		} );
	}, error => {
		if ( wiki.noWiki(error.message) ) {
			console.log( '- This wiki doesn\'t exist!' );
			msg.reactEmoji('nowiki');
		}
		else {
			console.log( '- Error while getting the statistics: ' + error );
			msg.sendChannelError( spoiler + '<' + wiki.toLink('Special:Statistics') + '>' + spoiler );
		}
		
		if ( reaction ) reaction.removeEmoji();
	} );
}

function minecraft_bug(lang, mclang, msg, args, title, cmd, querystring, fragment, reaction, spoiler) {
	var invoke = args[0];
	args = args.slice(1);
	if ( invoke && /\d+$/.test(invoke) && !args.length ) {
		if ( /^\d+$/.test(invoke) ) invoke = 'MC-' + invoke;
		var link = 'https://bugs.mojang.com/browse/';
		got.get( 'https://bugs.mojang.com/rest/api/2/issue/' + encodeURIComponent( invoke ) + '?fields=summary,issuelinks,fixVersions,resolution,status', {
			responseType: 'json'
		} ).then( response => {
			var body = response.body;
			if ( response.statusCode !== 200 || !body || body['status-code'] === 404 || body.errorMessages || body.errors ) {
				if ( body && body.errorMessages ) {
					if ( body.errorMessages.includes( 'Issue Does Not Exist' ) ) {
						msg.reactEmoji('🤷');
					}
					else if ( body.errorMessages.includes( 'You do not have the permission to see the specified issue.' ) ) {
						msg.sendChannel( spoiler + mclang.bug.private + '\n<' + link + invoke + '>' + spoiler );
					}
					else {
						console.log( '- ' + ( response && response.statusCode ) + ': Error while getting the issue: ' + body.errorMessages.join(' - ') );
						msg.reactEmoji('error');
					}
				}
				else {
					console.log( '- ' + response.statusCode + ': Error while getting the issue: ' + ( body && body.message ) );
					if ( body && body['status-code'] === 404 ) msg.reactEmoji('error');
					else msg.sendChannelError( spoiler + '<' + link + invoke + '>' + spoiler );
				}
			}
			else {
				if ( !body.fields ) {
					msg.reactEmoji('error');
				}
				else {
					var bugs = body.fields.issuelinks.filter( bug => bug.outwardIssue || ( bug.inwardIssue && bug.type.name != 'Duplicate' ) );
					if ( bugs.length ) {
						var embed = new Discord.MessageEmbed();
						var extrabugs = [];
						bugs.forEach( bug => {
							var ward = ( bug.outwardIssue ? 'outward' : 'inward' );
							var issue = bug[ward + 'Issue'];
							var name = bug.type[ward] + ' ' + issue.key;
							var value = issue.fields.status.name + ': [' + issue.fields.summary.escapeFormatting() + '](' + link + issue.key + ')';
							if ( embed.fields.length < 25 ) embed.addField( name, value );
							else extrabugs.push({name,value,inline:false});
						} );
						if ( extrabugs.length ) embed.setFooter( mclang.bug.more.replaceSave( '%s', extrabugs.length ) );
					}
					var status = '**' + ( body.fields.resolution ? body.fields.resolution.name : body.fields.status.name ) + ':** ';
					var fixed = '';
					if ( body.fields.resolution && body.fields.fixVersions && body.fields.fixVersions.length ) {
						fixed = '\n' + mclang.bug.fixed + ' ' + body.fields.fixVersions.map( v => v.name ).join(', ');
					}
					msg.sendChannel( spoiler + status + body.fields.summary.escapeFormatting() + '\n<' + link + body.key + '>' + fixed + spoiler, {embed} );
				}
			}
		}, error => {
			console.log( '- Error while getting the issue: ' + error );
			msg.sendChannelError( spoiler + '<' + link + invoke + '>' + spoiler );
		} ).finally( () => {
			if ( reaction ) reaction.removeEmoji();
		} );
	}
	else if ( invoke && invoke.toLowerCase() === 'version' && args.length && args.join(' ').length < 100 ) {
		var jql = 'fixVersion="' + args.join(' ').replace( /(["\\])/g, '\\$1' ).toSearch() + '"+order+by+key';
		var link = 'https://bugs.mojang.com/issues/?jql=' + jql;
		got.get( 'https://bugs.mojang.com/rest/api/2/search?fields=summary,resolution,status&jql=' + jql + '&maxResults=25', {
			responseType: 'json'
		} ).then( response => {
			var body = response.body;
			if ( response.statusCode !== 200 || !body || body['status-code'] === 404 || body.errorMessages || body.errors ) {
				if ( body && body.errorMessages ) {
					if ( body.errorMessages.includes( 'The value \'' + args.join(' ') + '\' does not exist for the field \'fixVersion\'.' ) ) {
						msg.reactEmoji('🤷');
					}
					else {
						console.log( '- ' + response.statusCode + ': Error while getting the issues: ' + body.errorMessages.join(' - ') );
						msg.reactEmoji('error');
					}
				}
				else {
					console.log( '- ' + response.statusCode + ': Error while getting the issues: ' + ( body && body.message ) );
					if ( body && body['status-code'] === 404 ) msg.reactEmoji('error');
					else msg.sendChannelError( spoiler + '<' + link + '>' + spoiler );
				}
			}
			else {
				if ( !body.issues ) {
					msg.reactEmoji('error');
				}
				else {
					if ( body.total > 0 ) {
						var embed = new Discord.MessageEmbed();
						body.issues.forEach( bug => {
							var status = ( bug.fields.resolution ? bug.fields.resolution.name : bug.fields.status.name );
							var value = status + ': [' + bug.fields.summary.escapeFormatting() + '](https://bugs.mojang.com/browse/' + bug.key + ')';
							embed.addField( bug.key, value );
						} );
						if ( body.total > 25 ) embed.setFooter( mclang.bug.more.replaceSave( '%s', body.total - 25 ) );
					}
					var total = '**' + args.join(' ') + ':** ' + mclang.bug.total.replaceSave( '%s', body.total );
					msg.sendChannel( spoiler + total + '\n<' + link + '>' + spoiler, {embed} );
				}
			}
		}, error => {
			console.log( '- Error while getting the issues: ' + error );
			msg.sendChannelError( spoiler + '<' + link + '>' + spoiler );
		} ).finally( () => {
			if ( reaction ) reaction.removeEmoji();
		} );
	}
	else {
		msg.notminecraft = true;
		gamepedia_check_wiki(lang, msg, title, mclang.link, cmd, reaction, spoiler, querystring, fragment);
	}
}

function minecraft_command(lang, mclang, msg, befehl, args, title, cmd, querystring, fragment, reaction, spoiler) {
	befehl = befehl.toLowerCase();
	var aliasCmd = ( minecraft.cmd.aliases[befehl] || befehl );
	
	if ( aliasCmd in minecraft.cmd.list ) {
		var cmdSyntaxMap = minecraft.cmd.list[aliasCmd].map( command => {
			var cmdargs = command.split(' ');
			if ( cmdargs[0].startsWith( '/' ) ) cmdargs = cmdargs.slice(1);
			var argmatches = cmdargs.map( (arg, i) => {
				if ( arg === args[i] ) return true;
			} );
			var matchCount = 0;
			argmatches.forEach( match => {
				if ( match ) matchCount++;
			} );
			return [argmatches.lastIndexOf(true),matchCount];
		} );
		var lastIndex = Math.max(...cmdSyntaxMap.map( command => command[0] ));
		var matchCount = Math.max(...cmdSyntaxMap.filter( command => command[0] === lastIndex ).map( command => command[1] ));
		var regex = new RegExp('/' + aliasCmd, 'g');
		var cmdSyntax = minecraft.cmd.list[aliasCmd].filter( (command, i) => ( lastIndex === -1 || cmdSyntaxMap[i][0] === lastIndex ) && cmdSyntaxMap[i][1] === matchCount ).join('\n').replaceSave( regex, '/' + befehl );
		msg.sendChannel( spoiler + '```md\n' + cmdSyntax + '```<' + mclang.link + mclang.cmd.page + aliasCmd + '>' + spoiler, {split:{maxLength:2000,prepend:spoiler + '```md\n',append:'```' + spoiler}} );
		if ( reaction ) reaction.removeEmoji();
	}
	else {
		msg.reactEmoji('❓');
		msg.notminecraft = true;
		gamepedia_check_wiki(lang, msg, title, mclang.link, cmd, reaction, spoiler, querystring, fragment);
	}
}

function minecraft_command2(lang, mclang, msg, args, title, cmd, querystring, fragment, reaction, spoiler) {
	if ( args.join('') ) {
		if ( args[0].startsWith( '/' ) ) minecraft_command(lang, mclang, msg, args[0].substring(1), args.slice(1), title, cmd, querystring, fragment, reaction, spoiler);
		else minecraft_command(lang, mclang, msg, args[0], args.slice(1), title, cmd, querystring, fragment, reaction, spoiler);
	}
	else {
		msg.notminecraft = true;
		gamepedia_check_wiki(lang, msg, title, mclang.link, cmd, reaction, spoiler, querystring, fragment);
	}
}

async function cmd_get(lang, msg, args, line, wiki) {
	var id = args.join().replace( /^\\?<(?:@!?|#)(\d+)>$/, '$1' );
	if ( /^\d+$/.test(id) ) {
		var guild = await client.shard.broadcastEval( `if ( this.guilds.cache.has('${id}') ) {
			var {name, id, memberCount, ownerID, owner, me: {permissions}} = this.guilds.cache.get('${id}');
			( {
				name, id, memberCount, ownerID,
				owner: owner?.user.tag,
				permissions: permissions.missing(${defaultPermissions}),
				pause: id in global.pause,
				voice: id in global.voice,
				shardId: global.shardId
			} )
		}` ).then( results => results.find( result => result !== null ) );
		if ( guild ) {
			var guildname = ['Guild:', guild.name.escapeFormatting() + ' `' + guild.id + '`' + ( guild.pause ? '\\*' : '' )];
			var guildowner = ['Owner:', ( guild.owner ? guild.owner.escapeFormatting() + ' ' : '' ) + '`' + guild.ownerID + '` <@' + guild.ownerID + '>'];
			var guildsize = ['Size:', guild.memberCount + ' members'];
			var guildshard = ['Shard:', guild.shardId];
			var guildpermissions = ['Missing permissions:', ( guild.permissions.length ? '`' + guild.permissions.join('`, `') + '`' : '*none*' )];
			var guildsettings = ['Settings:', '*unknown*'];
			
			return db.all( 'SELECT channel, prefix, lang, wiki, inline FROM discord WHERE guild = ? ORDER BY channel ASC', [guild.id], (dberror, rows) => {
				if ( dberror ) {
					console.log( '- Error while getting the settings: ' + dberror );
				}
				else if ( rows.length ) {
					row = rows.find( row => !row.channel );
					row.patreon = guild.id in patreons;
					row.voice = guild.voice;
					guildsettings[1] = '```json\n' + JSON.stringify( rows, null, '\t' ) + '\n```';
				}
				else guildsettings[1] = '*default*';
				
				if ( msg.showEmbed() ) {
					var embed = new Discord.MessageEmbed().addField( guildname[0], guildname[1] ).addField( guildowner[0], guildowner[1] ).addField( guildsize[0], guildsize[1], true ).addField( guildshard[0], guildshard[1], true ).addField( guildpermissions[0], guildpermissions[1] );
					var split = Discord.Util.splitMessage( guildsettings[1], {char:',\n',maxLength:1000,prepend:'```json\n',append:',\n```'} );
					if ( split.length > 5 ) {
						msg.sendChannel( '', {embed}, true );
						msg.sendChannel( guildsettings.join(' '), {split:{char:',\n',prepend:'```json\n',append:',\n```'}}, true );
					}
					else {
						split.forEach( guildsettingspart => embed.addField( guildsettings[0], guildsettingspart ) );
						msg.sendChannel( '', {embed}, true );
					}
				}
				else {
					var text = guildname.join(' ') + '\n' + guildowner.join(' ') + '\n' + guildsize.join(' ') + '\n' + guildshard.join(' ') + '\n' + guildpermissions.join(' ') + '\n' + guildsettings.join(' ');
					msg.sendChannel( text, {split:{char:',\n',prepend:'```json\n',append:',\n```'}}, true );
				}
			} );
		}
		
		var channel = await client.shard.broadcastEval( `if ( this.channels.cache.filter( channel => channel.type === 'text' ).has('${id}') ) {
			var {name, id, guild: {name: guild, id: guildID, me}} = this.channels.cache.get('${id}');
			( {
				name, id, guild, guildID,
				permissions: me.permissionsIn(id).missing(${defaultPermissions}),
				pause: guildID in global.pause,
				shardId: global.shardId
			} )
		}` ).then( results => results.find( result => result !== null ) );
		if ( channel ) {
			var channelguild = ['Guild:', channel.guild.escapeFormatting() + ' `' + channel.guildID + '`' + ( channel.pause ? '\\*' : '' )];
			var channelname = ['Channel:', '#' + channel.name.escapeFormatting() + ' `' + channel.id + '` <#' + channel.id + '>'];
			var channelpermissions = ['Missing permissions:', ( channel.permissions.length ? '`' + channel.permissions.join('`, `') + '`' : '*none*' )];
			var channellang = ['Language:', '*unknown*'];
			var channelwiki = ['Default Wiki:', '*unknown*'];
			var channelinline = ['Inline commands:', '*unknown*'];
			
			return db.get( 'SELECT lang, wiki, inline FROM discord WHERE guild = ? AND (channel = ? OR channel IS NULL) ORDER BY channel DESC', [channel.guildID, channel.id], (dberror, row) => {
				if ( dberror ) {
					console.log( '- Error while getting the settings: ' + dberror );
				}
				else if ( row ) {
					channellang[1] = row.lang;
					channelwiki[1] = row.wiki;
					channelinline[1] = ( row.inline ? 'disabled' : 'enabled' );
				}
				else {
					channellang[1] = defaultSettings.lang;
					channelwiki[1] = defaultSettings.wiki;
					channelinline[1] = 'enabled';
				}
				
				if ( msg.showEmbed() ) {
					var text = '';
					var embed = new Discord.MessageEmbed().addField( channelguild[0], channelguild[1] ).addField( channelname[0], channelname[1] ).addField( channelpermissions[0], channelpermissions[1] ).addField( channellang[0], channellang[1] ).addField( channelwiki[0], channelwiki[1] ).addField( channelinline[0], channelinline[1] );
				}
				else {
					var embed = {};
					var text = channelguild.join(' ') + '\n' + channelname.join(' ') + '\n' + channelpermissions.join(' ') + '\n' + channellang.join(' ') + '\n' + channelwiki[0] + ' <' + channelwiki[1] + '>\n' + channelinline.join(' ');
				}
				msg.sendChannel( text, {embed}, true );
			} );
		}
		
		var user = await client.users.fetch(id, false).catch( () => {} );
		if ( user ) {
			var username = ['User:', user.tag.escapeFormatting() + ' `' + user.id + '` <@' + user.id + '>'];
			var guildlist = ['Guilds:', '*none*'];
			var guilds = await client.shard.broadcastEval( `this.guilds.cache.filter( guild => guild.members.cache.has('${user.id}') ).map( guild => {
				var member = guild.members.cache.get('${user.id}');
				return {
					name: guild.name,
					id: guild.id,
					isAdmin: member.permissions.has('MANAGE_GUILD'),
					shardId: global.shardId
				}
			} )` ).then( results => results.reduce( (acc, val) => acc.concat(val), [] ).map( user_guild => {
				return user_guild.name.escapeFormatting() + ' `' + user_guild.id + '`' + ( user_guild.isAdmin ? '\\*' : '' );
			} ) );
			if ( guilds.length ) guildlist[1] = guilds.join('\n');
			if ( guildlist[1].length > 1000 ) guildlist[1] = guilds.length;
			if ( msg.showEmbed() ) {
				var text = '';
				var embed = new Discord.MessageEmbed().addField( username[0], username[1] ).addField( guildlist[0], guildlist[1] );
			}
			else {
				var embed = {};
				var text = username.join(' ') + '\n' + guildlist.join('\n');
			}
			return msg.sendChannel( text, {embed}, true );
		}
		
		msg.replyMsg( 'I couldn\'t find a result for `' + id + '`', {}, true );
	} else if ( msg.channel.type !== 'text' || !pause[msg.guild.id] ) cmd_link(lang, msg, line.split(' ').slice(1).join(' '), wiki);
}

function cmd_patreon(lang, msg, args, line, wiki) {
	if ( msg.channel.id !== process.env.channel || !args.join('') ) {
		if ( msg.channel.type !== 'text' || !pause[msg.guild.id] ) cmd_link(lang, msg, line.split(' ').slice(1).join(' '), wiki);
		return;
	}
	
	if ( args[0] === 'enable' && /^\d+$/.test(args.slice(1).join(' ')) ) return client.shard.broadcastEval( `this.guilds.cache.get('${args[1]}')?.name` ).then( results => {
		var guild = results.find( result => result !== null );
		if ( guild === undefined ) return msg.replyMsg( 'I\'m not on a server with the id `' + args[1] + '`.', {}, true );
		if ( args[1] in patreons ) return msg.replyMsg( '"' + guild + '" has the patreon features already enabled.', {}, true );
		db.get( 'SELECT count, COUNT(guild) guilds FROM patreons LEFT JOIN discord ON discord.patreon = patreons.patreon WHERE patreons.patreon = ? GROUP BY patreons.patreon', [msg.author.id], (dberror, row) => {
			if ( dberror ) {
				console.log( '- Error while getting the patreon: ' + dberror );
				msg.replyMsg( 'I got an error while searching for you, please try again later.', {}, true );
				return dberror;
			}
			if ( !row ) return msg.replyMsg( 'you can\'t have any server.', {}, true );
			if ( row.count <= row.guilds ) return msg.replyMsg( 'you already reached your maximal server count.', {}, true );
			db.run( 'UPDATE discord SET patreon = ? WHERE guild = ? AND channel IS NULL', [msg.author.id, args[1]], function (error) {
				if ( error ) {
					console.log( '- Error while updating the guild: ' + error );
					msg.replyMsg( 'I got an error while updating the server, please try again later.', {}, true );
					return error;
				}
				if ( !this.changes ) return db.run( 'INSERT INTO discord(guild, patreon) VALUES(?, ?)', [args[1], msg.author.id], function (inserror) {
					if ( inserror ) {
						console.log( '- Error while adding the guild: ' + inserror );
						msg.replyMsg( 'I got an error while updating the server, please try again later.', {}, true );
						return inserror;
					}
					console.log( '- Guild successfully added.' );
					client.shard.broadcastEval( `global.patreons['${args[1]}'] = '${process.env.prefix}'` );
					msg.replyMsg( 'the patreon features are now enabled on "' + guild + '".', {}, true );
				} );
				console.log( '- Guild successfully updated.' );
				client.shard.broadcastEval( `global.patreons['${args[1]}'] = '${process.env.prefix}'` );
				msg.replyMsg( 'the patreon features are now enabled on "' + guild + '".', {}, true );
			} );
		} );
	} );
	
	if ( args[0] === 'disable' && /^\d+$/.test(args.slice(1).join(' ')) ) return client.shard.broadcastEval( `this.guilds.cache.get('${args[1]}')?.name` ).then( results => {
		var guild = results.find( result => result !== null );
		if ( guild === undefined ) return msg.replyMsg( 'I\'m not on a server with the id `' + args[1] + '`.', {}, true );
		if ( !( args[1] in patreons ) ) return msg.replyMsg( '"' + guild + '" doesn\'t have the patreon features enabled.', {}, true );
		db.get( 'SELECT lang, inline FROM discord WHERE guild = ? AND patreon = ?', [args[1], msg.author.id], (dberror, row) => {
			if ( dberror ) {
				console.log( '- Error while getting the guild: ' + dberror );
				msg.replyMsg( 'I got an error while searching for the server, please try again later.', {}, true );
				return dberror;
			}
			if ( !row ) return msg.replyMsg( 'you didn\'t enable the patreon features for "' + guild + '"!', {}, true );
			db.run( 'UPDATE discord SET lang = ?, inline = ?, prefix = ?, patreon = NULL WHERE guild = ?', [row.lang, row.inline, process.env.prefix, args[1]], function (error) {
				if ( error ) {
					console.log( '- Error while updating the guild: ' + error );
					msg.replyMsg( 'I got an error while updating the server, please try again later.', {}, true );
					return error;
				}
				console.log( '- Guild successfully updated.' );
				client.shard.broadcastEval( `delete global.patreons['${args[1]}']` );
				msg.replyMsg( 'the patreon features are now disabled on "' + guild + '".', {}, true );
			} );
			db.all( 'SELECT configid FROM verification WHERE guild = ? ORDER BY configid ASC', [args[1]], (dberror, rows) => {
				if ( dberror ) {
					console.log( '- Error while getting the verifications: ' + dberror );
					return dberror;
				}
				var ids = rows.slice(10).map( row => row.configid );
				if ( ids.length ) db.run( 'DELETE FROM verification WHERE guild = ? AND configid IN (' + ids.map( configid => '?' ).join(', ') + ')', [args[1], ...ids], function (error) {
					if ( error ) {
						console.log( '- Error while deleting the verifications: ' + error );
						return error;
					}
					console.log( '- Verifications successfully deleted.' );
				} );
			} );
		} );
	} );
	
	if ( args[1] ) args[1] = args[1].replace( /^\\?<@!?(\d+)>$/, '$1' );
	
	if ( args[0] === 'check' ) {
		if ( !args.slice(1).join('') ) return db.get( 'SELECT count, GROUP_CONCAT(guild) guilds FROM patreons LEFT JOIN discord ON discord.patreon = patreons.patreon WHERE patreons.patreon = ? GROUP BY patreons.patreon', [msg.author.id], (dberror, row) => {
			if ( dberror ) {
				console.log( '- Error while getting the patreon: ' + dberror );
				msg.replyMsg( 'I got an error while searching for you, please try again later.', {}, true );
				return dberror;
			}
			if ( !row ) return msg.replyMsg( 'you can\'t have any server.', {}, true );
			var text = 'you can have up to ' + row.count + ' server.\n\n';
			if ( row.guilds ) {
				client.shard.broadcastEval( `'${row.guilds}'.split(',').map( guild => this.guilds.cache.get(guild)?.name )` ).then( results => {
					var guilds = row.guilds.split(',').map( (guild, i) => '`' + guild + '` ' + ( results.find( result => result[i] !== null )?.[i] || '' ) );
					text += 'Currently you have ' + guilds.length + ' server:\n' + guilds.join('\n');
					msg.replyMsg( text, {}, true );
				} );
			}
			else {
				text += '*You don\'t have any server yet.*';
				msg.replyMsg( text, {}, true );
			}
		} );
		if ( msg.isOwner() && /^\d+$/.test(args.slice(1).join(' ')) ) return db.get( 'SELECT count, GROUP_CONCAT(guild) guilds FROM patreons LEFT JOIN discord ON discord.patreon = patreons.patreon WHERE patreons.patreon = ? GROUP BY patreons.patreon', [args[1]], (dberror, row) => {
			if ( dberror ) {
				console.log( '- Error while getting the patreon: ' + dberror );
				msg.replyMsg( 'I got an error while searching for <@' + args[1] + '>, please try again later.', {}, true );
				return dberror;
			}
			if ( !row ) return msg.replyMsg( '<@' + args[1] + '> can\'t have any server.', {}, true );
			var text = '<@' + args[1] + '> can have up to ' + row.count + ' server.\n\n';
			if ( row.guilds ) {
				client.shard.broadcastEval( `'${row.guilds}'.split(',').map( guild => this.guilds.cache.get(guild)?.name )` ).then( results => {
					var guilds = row.guilds.split(',').map( (guild, i) => '`' + guild + '` ' + ( results.find( result => result[i] !== null )?.[i] || '' ) );
					text += 'Currently they have ' + guilds.length + ' server:\n' + guilds.join('\n');
					msg.replyMsg( text, {}, true );
				} );
			}
			else {
				text += '*They don\'t have any server yet.*';
				msg.replyMsg( text, {}, true );
			}
		} );
	}
	
	if ( args[0] === 'edit' && msg.isOwner() && /^\d+ [\+\-]?\d+$/.test(args.slice(1).join(' ')) ) return db.get( 'SELECT count, GROUP_CONCAT(guild) guilds FROM patreons LEFT JOIN discord ON discord.patreon = patreons.patreon WHERE patreons.patreon = ? GROUP BY patreons.patreon', [args[1]], (dberror, row) => {
		if ( dberror ) {
			console.log( '- Error while getting the patreon: ' + dberror );
			msg.replyMsg( 'I got an error while searching for <@' + args[1] + '>, please try again later.', {}, true );
			return dberror;
		}
		var value = parseInt(args[2], 10);
		var count = ( row ? row.count : 0 );
		var guilds = ( row && row.guilds ? row.guilds.split(',') : [] );
		if ( args[2].startsWith( '+' ) || args[2].startsWith( '-' ) ) count += value;
		else count = value;
		if ( count <= 0 ) return db.run( 'DELETE FROM patreons WHERE patreon = ?', [args[1]], function (error) {
			if ( error ) {
				console.log( '- Error while deleting the patreon: ' + error );
				msg.replyMsg( 'I got an error while deleting <@' + args[1] + '>, please try again later.', {}, true );
				return error;
			}
			console.log( '- Patreon successfully deleted.' );
			if ( !guilds.length ) return msg.replyMsg( '<@' + args[1] + '> is no longer a patreon.', {}, true );
			db.each( 'SELECT guild, lang, inline FROM discord WHERE guild IN (' + guilds.map( guild => '?' ).join(', ') + ') AND channel IS NULL', guilds, (eacherror, eachrow) => {
				if ( eacherror ) {
					console.log( '- Error while getting the guild: ' + eacherror );
					msg.replyMsg( 'I couldn\'t disable the patreon features.', {}, true );
					return eacherror;
				}
				db.run( 'UPDATE discord SET lang = ?, inline = ?, prefix = ? WHERE guild = ?', [eachrow.lang, eachrow.inline, process.env.prefix, eachrow.guild], function (uperror) {
					if ( uperror ) {
						console.log( '- Error while updating the guild: ' + uperror );
						msg.replyMsg( 'I couldn\'t disable the patreon features for `' + eachrow.guild + '`.', {}, true );
						return uperror;
					}
					console.log( '- Guild successfully updated.' );
					client.shard.broadcastEval( `delete global.patreons['${eachrow.guild}']` );
				} );
			}, (eacherror) => {
				if ( eacherror ) {
					console.log( '- Error while getting the guilds: ' + eacherror );
					msg.replyMsg( 'I couldn\'t disable the patreon features for `' + guilds.join('`, `') + '`.', {}, true );
					return eacherror;
				}
				msg.replyMsg( '<@' + args[1] + '> is no longer a patreon.', {}, true );
			} );
			db.each( 'SELECT a.guild, GROUP_CONCAT(DISTINCT a.configid) configids FROM verification a LEFT JOIN verification b ON a.guild = b.guild WHERE a.guild IN (' + guilds.map( guild => '?' ).join(', ') + ') GROUP BY a.guild', guilds, (eacherror, eachrow) => {
				if ( eacherror ) {
					console.log( '- Error while getting the verifications: ' + eacherror );
					return dberror;
				}
				var ids = eachrow.configids.split(',').slice(10).map( row => row.configid );
				if ( ids.length ) db.run( 'DELETE FROM verification WHERE guild = ? AND configid IN (' + ids.map( configid => '?' ).join(', ') + ')', [eachrow.guild, ...ids], function (uperror) {
					if ( uperror ) {
						console.log( '- Error while deleting the verifications: ' + uperror );
						return uperror;
					}
					console.log( '- Verifications successfully deleted.' );
				} );
			}, (eacherror) => {
				if ( eacherror ) {
					console.log( '- Error while getting the verifications: ' + eacherror );
					return eacherror;
				}
			} );
		} );
		if ( !row ) return db.run( 'INSERT INTO patreons(patreon, count) VALUES(?, ?)', [args[1], count], function (error) {
			if ( error ) {
				console.log( '- Error while adding the patreon: ' + error );
				msg.replyMsg( 'I got an error while adding <@' + args[1] + '>, please try again later.', {}, true );
				return error;
			}
			console.log( '- Patreon successfully added.' );
			msg.replyMsg( '<@' + args[1] + '> can now have up to ' + count + ' server.', {}, true );
		} );
		db.run( 'UPDATE patreons SET count = ? WHERE patreon = ?', [count, args[1]], function (error) {
			if ( error ) {
				console.log( '- Error while updating the patreon: ' + error );
				msg.replyMsg( 'I got an error while updating <@' + args[1] + '>, please try again later.', {}, true );
				return error;
			}
			console.log( '- Patreon successfully updated.' );
			var text = '<@' + args[1] + '> can now have up to ' + count + ' server.';
			if ( count < guilds.length ) text += '\n\n**They are now above their server limit!**';
			msg.replyMsg( text, {}, true );
		} );
	} );
	
	if ( msg.channel.type !== 'text' || !pause[msg.guild.id] ) cmd_link(lang, msg, line.split(' ').slice(1).join(' '), wiki);
}

function discussion_formatting(jsonModel) {
	var description = '';
	switch ( jsonModel.type ) {
		case 'doc':
			if ( jsonModel.content ) jsonModel.content.forEach( content => description += discussion_formatting(content) );
			break;
		case 'paragraph':
			if ( jsonModel.content ) jsonModel.content.forEach( content => description += discussion_formatting(content) );
			description += '\n';
			break;
		case 'openGraph':
			if ( !jsonModel.attrs.wasAddedWithInlineLink ) description += jsonModel.attrs.url + '\n';
			break;
		case 'text':
			var prepend = '';
			var append = '';
			if ( jsonModel.marks ) {
				jsonModel.marks.forEach( mark => {
					switch ( mark.type ) {
						case 'mention':
							prepend += '[';
							append = ']({@wiki}f/u/' + mark.attrs.userId + ')' + append;
							break;
						case 'link':
							prepend += '[';
							append = '](' + mark.attrs.href + ')' + append;
							break;
						case 'strong':
							prepend += '**';
							append = '**' + append;
							break;
						case 'em':
							prepend += '_';
							append = '_' + append;
							break;
					}
				} );
			}
			description += prepend + jsonModel.text.escapeFormatting() + append;
			break;
		case 'image':
			if ( jsonModel.attrs.id !== null ) description += '{@' + jsonModel.attrs.id + '}\n';
			break;
		case 'code_block':
			description += '```\n';
			if ( jsonModel.content ) jsonModel.content.forEach( content => description += discussion_formatting(content) );
			description += '\n```\n';
			break;
		case 'bulletList':
			jsonModel.content.forEach( listItem => {
				description += '\t• ';
				if ( listItem.content ) listItem.content.forEach( content => description += discussion_formatting(content) );
			} );
			break;
		case 'orderedList':
			var n = 1;
			jsonModel.content.forEach( listItem => {
				description += '\t' + n + '. ';
				n++;
				if ( listItem.content ) listItem.content.forEach( content => description += discussion_formatting(content) );
			} );
			break;
	}
	return description;
}

function htmlToPlain(html) {
	var text = '';
	var parser = new htmlparser.Parser( {
		ontext: (htmltext) => {
			text += htmltext.escapeFormatting();
		}
	}, {decodeEntities:true} );
	parser.write( html );
	parser.end();
	return text;
};

function htmlToDiscord(html) {
	var text = '';
	var parser = new htmlparser.Parser( {
		onopentag: (tagname, attribs) => {
			switch (tagname) {
				case 'b':
					text += '**';
					break;
				case 'i':
					text += '*';
					break;
				case 's':
					text += '~~';
					break;
				case 'u':
					text += '__';
					break;
			}
		},
		ontext: (htmltext) => {
			text += htmltext.escapeFormatting();
		},
		onclosetag: (tagname) => {
			switch (tagname) {
				case 'b':
					text += '**';
					break;
				case 'i':
					text += '*';
					break;
				case 's':
					text += '~~';
					break;
				case 'u':
					text += '__';
					break;
			}
		}
	}, {decodeEntities:true} );
	parser.write( html );
	parser.end();
	return text;
};

String.prototype.noWiki = function(href) {
	if ( !href ) return false;
	else if ( this.startsWith( 'https://www.' ) ) return true;
	else if ( this.endsWith( '.gamepedia.com/' ) ) return 'https://www.gamepedia.com/' === href;
	else return [
		this.replace( /^https:\/\/([a-z\d-]{1,50}\.(?:fandom\.com|wikia\.org))\/(?:[a-z-]{1,8}\/)?$/, 'https://community.fandom.com/wiki/Community_Central:Not_a_valid_community?from=$1' ),
		this + 'language-wikis'
	].includes( href.replace( /Unexpected token < in JSON at position 0 in "([^ ]+)"/, '$1' ) );
};

String.prototype.isFandom = function() {
	return /^https:\/\/[a-z\d-]{1,50}\.(?:fandom\.com|wikia\.org)\/(?:[a-z-]{1,8}\/)?$/.test(this);
};

String.prototype.isMention = function(guild) {
	var text = this.trim();
	return text === '@' + client.user.username || text.replace( /^<@!?(\d+)>$/, '$1' ) === client.user.id || ( guild && text === '@' + guild.me.displayName );
};

Discord.Message.prototype.isAdmin = function() {
	return this.channel.type === 'text' && this.member && ( this.member.permissions.has('MANAGE_GUILD') || ( this.isOwner() && this.evalUsed ) );
};

Discord.Message.prototype.isOwner = function() {
	return this.author.id === process.env.owner;
};

Discord.Message.prototype.showEmbed = function() {
	return this.channel.type !== 'text' || this.channel.permissionsFor(client.user).has('EMBED_LINKS');
};

Discord.Message.prototype.uploadFiles = function() {
	return this.channel.type !== 'text' || this.channel.permissionsFor(client.user).has('ATTACH_FILES');
};

String.prototype.toLink = function(title = '', querystring = '', fragment = '', path, isMarkdown = false) {
	var linksuffix = ( querystring ? '?' + querystring : '' ) + ( fragment ? '#' + fragment.toSection() : '' );
	if ( path ) return ( path.server.startsWith( '//' ) ? 'https:' : '' ) + path.server + path.articlepath.replaceSave( '$1', title.toTitle(isMarkdown, path.articlepath.includes( '?' )) ) + ( path.articlepath.includes( '?' ) && linksuffix.startsWith( '?' ) ? '&' + linksuffix.substring(1) : linksuffix );
	else if ( this.endsWith( '.gamepedia.com/' ) ) return this + title.toTitle(isMarkdown) + linksuffix;
	else if ( this.isFandom() ) return this + 'wiki/' + title.toTitle(isMarkdown) + linksuffix;
	else return this + 'index.php?title=' + title.toTitle(isMarkdown, true) + ( linksuffix.startsWith( '?' ) ? '&' + linksuffix.substring(1) : linksuffix );
};

String.prototype.toDescLink = function(title = '') {
	return this + 'wiki/' + encodeURIComponent( title.replace( / /g, '_' ) );
};

String.prototype.toTitle = function(isMarkdown = false, inQuery = false) {
	var title = this.replace( / /g, '_' ).replace( /\%/g, '%25' ).replace( /\\/g, '%5C' ).replace( /\?/g, '%3F' ).replace( /@(here|everyone)/g, '%40$1' );
	if ( inQuery ) title = title.replace( /\&/g, '%26' );
	if ( isMarkdown ) title = title.replace( /([\(\)])/g, '\\$1' );
	return title;
};

String.prototype.toSearch = function() {
	return encodeURIComponent( this ).replace( /%20/g, '+' );
};

String.prototype.toSection = function() {
	return encodeURIComponent( this.replace( / /g, '_' ) ).replace( /\'/g, '%27' ).replace( /\(/g, '%28' ).replace( /\)/g, '%29' ).replace( /\%/g, '.' );
};

String.prototype.toFormatting = function(showEmbed = false, ...args) {
	if ( showEmbed ) return this.toMarkdown(...args);
	else return this.toPlaintext();
};

String.prototype.toMarkdown = function(wiki, path, title = '') {
	var text = this.replace( /[\(\)\\]/g, '\\$&' );
	var link = null;
	while ( ( link = /\[\[(?:([^\|\]]+)\|)?([^\]]+)\]\]([a-z]*)/g.exec(text) ) !== null ) {
		var pagetitle = ( link[1] || link[2] );
		var page = wiki.toLink(( /^[#\/]/.test(pagetitle) ? title + ( pagetitle.startsWith( '/' ) ? pagetitle : '' ) : pagetitle ), '', ( pagetitle.startsWith( '#' ) ? pagetitle.substring(1) : '' ), path, true);
		text = text.replaceSave( link[0], '[' + link[2] + link[3] + '](' + page + ')' );
	}
	while ( title !== '' && ( link = /\/\*\s*([^\*]+?)\s*\*\/\s*(.)?/g.exec(text) ) !== null ) {
		text = text.replaceSave( link[0], '[→' + link[1] + '](' + wiki.toLink(title, '', link[1], path, true) + ')' + ( link[2] ? ': ' + link[2] : '' ) );
	}
	return text.escapeFormatting(true);
};

String.prototype.toPlaintext = function() {
	return this.replace( /\[\[(?:[^\|\]]+\|)?([^\]]+)\]\]/g, '$1' ).replace( /\/\*\s*([^\*]+?)\s*\*\//g, '→$1:' ).escapeFormatting();
};

String.prototype.escapeFormatting = function(isMarkdown) {
	var text = this;
	if ( !isMarkdown ) text = text.replace( /[\(\)\\]/g, '\\$&' );
	return text.replace( /[`_\*~:<>{}@\|]|\/\//g, '\\$&' );
};

String.prototype.replaceSave = function(pattern, replacement) {
	return this.replace( pattern, ( typeof replacement === 'string' ? replacement.replace( /\$/g, '$$$$' ) : replacement ) );
};

Discord.Message.prototype.reactEmoji = function(name, ignorePause = false) {
	if ( this.channel.type !== 'text' || !pause[this.guild.id] || ( ignorePause && ( this.isAdmin() || this.isOwner() ) ) ) {
		var emoji = '440871715938238494';
		switch ( name ) {
			case 'nowiki':
				emoji = ':unknown_wiki:505884572001763348';
				break;
			case 'error':
				emoji = ':error:440871715938238494';
				break;
			default:
				emoji = name;
		}
		return this.react(emoji).catch(log_error);
	} else {
		console.log( '- Aborted, paused.' );
		return Promise.resolve();
	}
};

Discord.MessageReaction.prototype.removeEmoji = function() {
	return this.users.remove().catch(log_error);
};

Discord.Message.prototype.sendChannel = function(content, options = {}, ignorePause = false) {
	if ( this.channel.type !== 'text' || !pause[this.guild.id] || ( ignorePause && ( this.isAdmin() || this.isOwner() ) ) ) {
		if ( !options.allowedMentions ) options.allowedMentions = {parse:[]};
		return this.channel.send(content, options).then( msg => {
			if ( msg.length ) msg.forEach( message => message.allowDelete(this.author.id) );
			else msg.allowDelete(this.author.id);
			return msg;
		}, error => {
			log_error(error);
			this.reactEmoji('error');
		} );
	} else {
		console.log( '- Aborted, paused.' );
		return Promise.resolve();
	}
};

Discord.Message.prototype.sendChannelError = function(content, options = {}) {
	if ( !options.allowedMentions ) options.allowedMentions = {parse:[]};
	return this.channel.send(content, options).then( msg => {
		if ( msg.length ) msg.forEach( message => {
			message.reactEmoji('error');
			message.allowDelete(this.author.id);
		} );
		else {
			msg.reactEmoji('error');
			msg.allowDelete(this.author.id);
		}
		return msg;
	}, error => {
		log_error(error);
		this.reactEmoji('error');
	} );
};

Discord.Message.prototype.replyMsg = function(content, options = {}, ignorePause = false, allowDelete = true) {
	if ( this.channel.type !== 'text' || !pause[this.guild.id] || ( ignorePause && ( this.isAdmin() || this.isOwner() ) ) ) {
		if ( !options.allowedMentions ) options.allowedMentions = {users:[this.author.id]};
		return this.reply(content, options).then( msg => {
			if ( allowDelete ) {
				if ( msg.length ) msg.forEach( message => message.allowDelete(this.author.id) );
				else msg.allowDelete(this.author.id);
			}
			return msg;
		}, error => {
			log_error(error);
			this.reactEmoji('error');
		} );
	} else {
		console.log( '- Aborted, paused.' );
		return Promise.resolve();
	}
};

Discord.Message.prototype.deleteMsg = function(timeout = 0) {
	return this.delete({timeout}).catch(log_error);
};

Discord.Message.prototype.allowDelete = function(author) {
	return this.awaitReactions( (reaction, user) => reaction.emoji.name === '🗑️' && user.id === author, {max:1,time:120000} ).then( reaction => {
		if ( reaction.size ) {
			this.deleteMsg();
		}
	} );
};

String.prototype.hasPrefix = function(prefix, flags = '') {
	return new RegExp( '^' + prefix.replace( /\W/g, '\\$&' ) + '(?: |$)', flags ).test(this.replace( /\u200b/g, '' ).toLowerCase());
};

client.on( 'message', msg => {
	if ( stop || msg.type !== 'DEFAULT' || msg.system || msg.webhookID || msg.author.id === client.user.id ) return;
	if ( !msg.content.hasPrefix(( msg.channel.type === 'text' && patreons[msg.guild.id] || process.env.prefix ), 'm') ) {
		if ( msg.content === process.env.prefix + ' help' && ( msg.isAdmin() || msg.isOwner() ) ) {
			if ( msg.channel.permissionsFor(client.user).has('SEND_MESSAGES') ) {
				console.log( msg.guild.name + ': ' + msg.content );
				db.get( 'SELECT lang FROM discord WHERE guild = ? AND (channel = ? OR channel IS NULL) ORDER BY channel DESC', [msg.guild.id, msg.channel.id], (dberror, row) => {
					if ( dberror ) console.log( '- Error while getting the lang: ' + dberror );
					msg.replyMsg( i18n[( row || defaultSettings ).lang].prefix.replaceSave( /%s/g, patreons[msg.guild.id] ), {}, true );
				} );
			}
		}
		if ( !( msg.content.includes( '[[' ) && msg.content.includes( ']]' ) ) && !( msg.content.includes( '{{' ) && msg.content.includes( '}}' ) ) ) return;
	}
	if ( !ready.allSites && !allSites.length ) getAllSites();
	if ( msg.channel.type === 'text' ) {
		var permissions = msg.channel.permissionsFor(client.user);
		var missing = permissions.missing(['SEND_MESSAGES','ADD_REACTIONS','USE_EXTERNAL_EMOJIS','READ_MESSAGE_HISTORY']);
		if ( missing.length ) {
			if ( msg.isAdmin() || msg.isOwner() ) {
				console.log( msg.guild.id + ': Missing permissions - ' + missing.join(', ') );
				if ( !missing.includes( 'SEND_MESSAGES' ) ) {
					db.get( 'SELECT lang FROM discord WHERE guild = ? AND (channel = ? OR channel IS NULL) ORDER BY channel DESC', [msg.guild.id, msg.channel.id], (dberror, row) => {
						if ( dberror ) console.log( '- Error while getting the lang: ' + dberror );
						if ( msg.content.hasPrefix(( patreons[msg.guild.id] || process.env.prefix ), 'm') ) {
							msg.replyMsg( i18n[( row || defaultSettings ).lang].missingperm + ' `' + missing.join('`, `') + '`', {}, true );
						}
					} );
				}
			}
			return;
		}
		db.get( 'SELECT wiki, lang, inline FROM discord WHERE guild = ? AND (channel = ? OR channel IS NULL) ORDER BY channel DESC', [msg.guild.id, msg.channel.id], (dberror, row) => {
			if ( dberror ) {
				console.log( '- Error while getting the wiki: ' + dberror );
				if ( permissions.has('SEND_MESSAGES') ) {
					msg.sendChannel( '⚠️ **Limited Functionality** ⚠️\nNo settings found, please contact the bot owner!\n' + process.env.invite, {}, true );
					newMessage(msg);
				}
				return dberror;
			}
			if ( row ) newMessage(msg, row.wiki, i18n[row.lang], patreons[msg.guild.id], row.inline);
			else {
				msg.defaultSettings = true;
				newMessage(msg);
			}
		} );
	}
	else newMessage(msg);
} );

function newMessage(msg, wiki = defaultSettings.wiki, lang = i18n[defaultSettings.lang], prefix = process.env.prefix, noInline = null, content) {
	msg.noInline = noInline;
	var cont = ( content || msg.content );
	var cleanCont = ( content || msg.cleanContent );
	var author = msg.author;
	var channel = msg.channel;
	var invoke = ( cont.split(' ')[1] ? cont.split(' ')[1].split('\n')[0].toLowerCase() : '' );
	var aliasInvoke = ( lang.aliases[invoke] || invoke );
	var ownercmd = ( msg.isOwner() && aliasInvoke in ownercmdmap );
	if ( cont.hasPrefix(prefix) && ownercmd ) {
		var args = cont.split(' ').slice(2);
		if ( cont.split(' ')[1].split('\n')[1] ) args.unshift( '', cont.split(' ')[1].split('\n')[1] );
		else console.log( ( channel.type === 'text' ? msg.guild.id : '@' + author.id ) + ': ' + cont );
		ownercmdmap[aliasInvoke](lang, msg, args, cont, wiki);
	} else {
		var count = 0;
		var maxcount = ( channel.type === 'text' && msg.guild.id in patreons ? 15 : 10 );
		cleanCont.replace( /\u200b/g, '' ).split('\n').forEach( line => {
			if ( line.hasPrefix(prefix) && count < maxcount ) {
				count++;
				invoke = ( line.split(' ')[1] ? line.split(' ')[1].toLowerCase() : '' );
				var args = line.split(' ').slice(2);
				aliasInvoke = ( lang.aliases[invoke] || invoke );
				ownercmd = ( msg.isOwner() && aliasInvoke in ownercmdmap );
				if ( channel.type === 'text' && pause[msg.guild.id] && !( ( msg.isAdmin() && aliasInvoke in pausecmdmap ) || ownercmd ) ) console.log( msg.guild.id + ': Paused' );
				else console.log( ( channel.type === 'text' ? msg.guild.id : '@' + author.id ) + ': ' + line );
				if ( ownercmd ) ownercmdmap[aliasInvoke](lang, msg, args, line, wiki);
				else if ( channel.type !== 'text' || !pause[msg.guild.id] || ( msg.isAdmin() && aliasInvoke in pausecmdmap ) ) {
					if ( aliasInvoke in cmdmap ) cmdmap[aliasInvoke](lang, msg, args, line, wiki);
					else if ( /^![a-z\d-]{1,50}$/.test(invoke) ) {
						cmd_link(lang, msg, args.join(' '), 'https://' + invoke.substring(1) + '.gamepedia.com/', ' ' + invoke + ' ');
					}
					else if ( /^\?(?:[a-z-]{1,8}\.)?[a-z\d-]{1,50}$/.test(invoke) ) {
						var invokeWiki = wiki;
						if ( invoke.includes( '.' ) ) invokeWiki = 'https://' + invoke.split('.')[1] + '.fandom.com/' + invoke.substring(1).split('.')[0] + '/';
						else invokeWiki = 'https://' + invoke.substring(1) + '.fandom.com/';
						cmd_link(lang, msg, args.join(' '), invokeWiki, ' ' + invoke + ' ');
					}
					else if ( /^\?\?(?:[a-z-]{1,8}\.)?[a-z\d-]{1,50}$/.test(invoke) ) {
						var invokeWiki = wiki;
						if ( invoke.includes( '.' ) ) invokeWiki = 'https://' + invoke.split('.')[1] + '.wikia.org/' + invoke.substring(2).split('.')[0] + '/';
						else invokeWiki = 'https://' + invoke.substring(2) + '.wikia.org/';
						cmd_link(lang, msg, args.join(' '), invokeWiki, ' ' + invoke + ' ');
					}
					else cmd_link(lang, msg, line.split(' ').slice(1).join(' '), wiki);
				}
			} else if ( line.hasPrefix(prefix) && count === maxcount ) {
				count++;
				console.log( '- Message contains too many commands!' );
				msg.reactEmoji('⚠️');
				msg.sendChannelError( lang.limit.replaceSave( '%s', '<@' + author.id + '>' ), {allowedMentions:{users:[author.id]}} );
			}
		} );
		
		if ( ( channel.type !== 'text' || !pause[msg.guild.id] ) && !noInline && ( cont.includes( '[[' ) || cont.includes( '{{' ) ) ) {
			var links = [];
			var embeds = [];
			var linkcount = 0;
			var linkmaxcount = maxcount + 5;
			msg.cleanContent.replace( /\u200b/g, '' ).replace( /(?<!\\)```.+?```/gs, '<codeblock>' ).replace( /(?<!\\)`.+?`/gs, '<code>' ).split('\n').forEach( line => {
				if ( line.hasPrefix(prefix) || !( line.includes( '[[' ) || line.includes( '{{' ) ) ) return;
				if ( line.includes( '[[' ) && line.includes( ']]' ) && linkcount <= linkmaxcount ) {
					let regex = new RegExp( '(?<!\\\\)(|\\|\\|)\\[\\[([^' + "<>\\[\\]\\|{}\\x01-\\x1F\\x7F" + ']+)(?<!\\\\)\\]\\]\\1', 'g' );
					let entry = null;
					while ( ( entry = regex.exec(line) ) !== null ) {
						if ( linkcount < linkmaxcount ) {
							linkcount++;
							console.log( ( channel.type === 'text' ? msg.guild.id : '@' + author.id ) + ': ' + entry[0] );
							let title = entry[2].split('#')[0];
							let section = ( entry[2].includes( '#' ) ? entry[2].split('#').slice(1).join('#') : '' )
							links.push({title,section,spoiler:entry[1]});
						}
						else if ( linkcount === linkmaxcount ) {
							linkcount++;
							console.log( '- Message contains too many links!' );
							msg.reactEmoji('⚠️');
							break;
						}
					}
				}
				
				if ( line.includes( '{{' ) && line.includes( '}}' ) && count <= maxcount ) {
					let regex = new RegExp( '(?<!\\\\)(|\\|\\|)(?<!\\{)\\{\\{([^' + "<>\\[\\]\\|{}\\x01-\\x1F\\x7F" + ']+)(?<!\\\\)\\}\\}\\1', 'g' );
					let entry = null;
					while ( ( entry = regex.exec(line) ) !== null ) {
						if ( count < maxcount ) {
							count++;
							console.log( ( channel.type === 'text' ? msg.guild.id : '@' + author.id ) + ': ' + entry[0] );
							let title = entry[2].split('#')[0];
							let section = ( entry[2].includes( '#' ) ? entry[2].split('#').slice(1).join('#') : '' )
							embeds.push({title,section,spoiler:entry[1]});
						}
						else if ( count === maxcount ) {
							count++;
							console.log( '- Message contains too many links!' );
							msg.reactEmoji('⚠️');
							break;
						}
					}
				}
			} );
		
			if ( links.length ) got.get( wiki + 'api.php?action=query&meta=siteinfo&siprop=general&iwurl=true&titles=' + encodeURIComponent( links.map( link => link.title ).join('|') ) + '&format=json', {
				responseType: 'json'
			} ).then( response => {
				var body = response.body;
				if ( response.statusCode !== 200 || !body || !body.query ) {
					if ( wiki.noWiki(response.url) || response.statusCode === 410 ) {
						console.log( '- This wiki doesn\'t exist!' );
						msg.reactEmoji('nowiki');
						return;
					}
					console.log( '- ' + response.statusCode + ': Error while following the links: ' + ( body && body.error && body.error.info ) );
					return;
				}
				if ( body.query.normalized ) {
					body.query.normalized.forEach( title => links.filter( link => link.title === title.from ).forEach( link => link.title = title.to ) );
				}
				if ( body.query.interwiki ) {
					body.query.interwiki.forEach( interwiki => links.filter( link => link.title === interwiki.title ).forEach( link => {
						link.url = interwiki.url + ( link.section ? '#' + link.section.toSection() : '' );
					} ) );
				}
				if ( body.query.pages ) {
					var querypages = Object.values(body.query.pages);
					querypages.filter( page => page.invalid !== undefined ).forEach( page => links.filter( link => link.title === page.title ).forEach( link => {
						links.splice(links.indexOf(link), 1);
					} ) );
					querypages.filter( page => page.missing !== undefined && page.known === undefined ).forEach( page => links.filter( link => link.title === page.title ).forEach( link => {
						if ( ( page.ns === 2 || page.ns === 202 ) && !page.title.includes( '/' ) ) return;
						link.url = wiki.toLink(link.title, 'action=edit&redlink=1', '', body.query.general);
					} ) );
				}
				if ( links.length ) msg.sendChannel( links.map( link => link.spoiler + '<' + ( link.url || wiki.toLink(link.title, '', link.section, body.query.general) ) + '>' + link.spoiler ).join('\n'), {split:true} );
			}, error => {
				if ( wiki.noWiki(error.message) ) {
					console.log( '- This wiki doesn\'t exist!' );
					msg.reactEmoji('nowiki');
				}
				else {
					console.log( '- Error while following the links: ' + error );
				}
			} );
			
			if ( embeds.length ) got.get( wiki + 'api.php?action=query&meta=siteinfo&siprop=general' + ( wiki.isFandom() ? '' : '|variables' ) + '&titles=' + encodeURIComponent( embeds.map( embed => embed.title + '|Template:' + embed.title ).join('|') ) + '&format=json', {
				responseType: 'json'
			} ).then( response => {
				var body = response.body;
				if ( response.statusCode !== 200 || !body || !body.query ) {
					if ( wiki.noWiki(response.url) || response.statusCode === 410 ) {
						console.log( '- This wiki doesn\'t exist!' );
						msg.reactEmoji('nowiki');
						return;
					}
					console.log( '- ' + response.statusCode + ': Error while following the links: ' + ( body && body.error && body.error.info ) );
					return;
				}
				if ( body.query.normalized ) {
					body.query.normalized.forEach( title => embeds.filter( embed => embed.title === title.from ).forEach( embed => embed.title = title.to ) );
				}
				if ( body.query.pages ) {
					var querypages = Object.values(body.query.pages);
					querypages.filter( page => page.invalid !== undefined ).forEach( page => embeds.filter( embed => embed.title === page.title ).forEach( embed => {
						embeds.splice(embeds.indexOf(embed), 1);
					} ) );
					var missing = [];
					querypages.filter( page => page.missing !== undefined && page.known === undefined ).forEach( page => embeds.filter( embed => embed.title === page.title ).forEach( embed => {
						if ( ( page.ns === 2 || page.ns === 202 ) && !page.title.includes( '/' ) ) return;
						embeds.splice(embeds.indexOf(embed), 1);
						if ( page.ns === 0 && !embed.section ) {
							var template = querypages.find( template => template.ns === 10 && template.title.split(':').slice(1).join(':') === embed.title );
							if ( template && template.missing === undefined ) embed.template = wiki.toLink(template.title, '', '', body.query.general);
						}
						if ( embed.template || !body.query.variables || !body.query.variables.some( variable => variable.toUpperCase() === embed.title ) ) missing.push(embed);
					} ) );
					if ( missing.length ) {
						msg.sendChannel( missing.map( embed => embed.spoiler + '<' + ( embed.template || wiki.toLink(embed.title, 'action=edit&redlink=1', '', body.query.general) ) + '>' + embed.spoiler ).join('\n'), {split:true} );
					}
				}
				if ( embeds.length ) {
					if ( wiki.isFandom() ) embeds.forEach( embed => msg.reactEmoji('⏳').then( reaction => {
						fandom_check_wiki(lang, msg, embed.title, wiki, ' ', reaction, embed.spoiler, '', embed.section);
					} ) );
					else embeds.forEach( embed => msg.reactEmoji('⏳').then( reaction => {
						gamepedia_check_wiki(lang, msg, embed.title, wiki, ' ', reaction, embed.spoiler, '', embed.section);
					} ) );
				}
			}, error => {
				if ( wiki.noWiki(error.message) ) {
					console.log( '- This wiki doesn\'t exist!' );
					msg.reactEmoji('nowiki');
				}
				else {
					console.log( '- Error while following the links: ' + error );
				}
			} );
		}
	}
}


client.on( 'voiceStateUpdate', (olds, news) => {
	if ( stop || !( olds.guild.id in voice ) || !olds.guild.me.permissions.has('MANAGE_ROLES') || olds.channelID === news.channelID ) return;
	if ( !ready.allSites && !allSites.length ) getAllSites();
	var lang = i18n[voice[olds.guild.id]].voice;
	if ( olds.member && olds.channel ) {
		var oldrole = olds.member.roles.cache.find( role => role.name === lang.channel + ' – ' + olds.channel.name );
		if ( oldrole && oldrole.comparePositionTo(olds.guild.me.roles.highest) < 0 ) {
			console.log( olds.guild.id + ': ' + olds.member.id + ' left the voice channel "' + olds.channel.id + '".' );
			olds.member.roles.remove( oldrole, lang.left.replaceSave( '%1$s', olds.member.displayName ).replaceSave( '%2$s', olds.channel.name ) ).catch(log_error);
		}
	}
	if ( news.member && news.channel ) {
		var newrole = news.guild.roles.cache.find( role => role.name === lang.channel + ' – ' + news.channel.name );
		if ( newrole && newrole.comparePositionTo(news.guild.me.roles.highest) < 0 ) {
			console.log( news.guild.id + ': ' + news.member.id + ' joined the voice channel "' + news.channel.id + '".' );
			news.member.roles.add( newrole, lang.join.replaceSave( '%1$s', news.member.displayName ).replaceSave( '%2$s', news.channel.name ) ).catch(log_error);
		}
	}
} );


client.on( 'guildCreate', guild => {
	console.log( '- I\'ve been added to a server.' );
} );

client.on( 'guildDelete', guild => {
	if ( !guild.available ) {
		console.log( '- ' + guild.id + ': This server isn\'t responding.' );
		return;
	}
	console.log( '- I\'ve been removed from a server.' );
	db.run( 'DELETE FROM discord WHERE guild = ?', [guild.id], function (dberror) {
		if ( dberror ) {
			console.log( '- Error while removing the settings: ' + dberror );
			return dberror;
		}
		if ( guild.id in patreons ) client.shard.broadcastEval( `delete global.patreons['${guild.id}']` );
		if ( guild.id in voice ) delete voice[guild.id];
		console.log( '- Settings successfully removed.' );
	} );
	db.run( 'DELETE FROM verification WHERE guild = ?', [guild.id], function (dberror) {
		if ( dberror ) {
			console.log( '- Error while removing the verifications: ' + dberror );
			return dberror;
		}
		console.log( '- Verifications successfully removed.' );
	} );
} );

function removePatreons(guild, msg) {
	try {
		if ( !guild ) return 'removePatreons(guild, msg) – No guild provided!';
		db.get( 'SELECT lang, inline FROM discord WHERE guild = ? AND channel IS NULL', [guild], (dberror, row) => {
			try {
				if ( dberror ) {
					console.log( '- Error while getting the guild: ' + dberror );
					if ( msg ) msg.replyMsg( 'I got an error while searching for the guild!', {}, true );
					return dberror;
				}
				if ( !row ) {
					if ( msg ) msg.replyMsg( 'that guild doesn\'t exist!', {}, true );
					return;
				}
				db.run( 'UPDATE discord SET lang = ?, inline = ?, prefix = ?, patreon = NULL WHERE guild = ?', [row.lang, row.inline, process.env.prefix, guild], function (error) {
					try {
						if ( error ) {
							console.log( '- Error while updating the guild: ' + error );
							if ( msg ) msg.replyMsg( 'I got an error while updating the guild!', {}, true );
							return error;
						}
						console.log( '- Guild successfully updated.' );
						client.shard.broadcastEval( `delete global.patreons['${guild}']`);
						if ( msg ) msg.replyMsg( 'the patreon features are now disabled on that guild.', {}, true );
					}
					catch ( tryerror ) {
						console.log( '- Error while removing the patreon features: ' + tryerror );
					}
				} );
			}
			catch ( tryerror ) {
				console.log( '- Error while removing the patreon features: ' + tryerror );
			}
		} );
		db.all( 'SELECT configid FROM verification WHERE guild = ? ORDER BY configid ASC', [guild], (dberror, rows) => {
			if ( dberror ) {
				console.log( '- Error while getting the verifications: ' + dberror );
				return dberror;
			}
			var ids = rows.slice(10).map( row => row.configid );
			if ( ids.length ) db.run( 'DELETE FROM verification WHERE guild = ? AND configid IN (' + ids.map( configid => '?' ).join(', ') + ')', [guild, ...ids], function (error) {
				if ( error ) {
					console.log( '- Error while deleting the verifications: ' + error );
					return error;
				}
				console.log( '- Verifications successfully deleted.' );
			} );
		} );
	}
	catch ( tryerror ) {
		console.log( '- Error while removing the patreon features: ' + tryerror );
		return 'removePatreons(guild, msg) – Error while removing the patreon features: ' + tryerror;
	}
}

function removeSettings() {
	client.shard.broadcastEval( `[[...this.guilds.cache.keys()], [...this.channels.cache.filter( channel => channel.type === 'text' ).keys()]]` ).then( results => {
		var all_guilds = results.map( result => result[0] ).reduce( (acc, val) => acc.concat(val), [] );
		var all_channels = results.map( result => result[1] ).reduce( (acc, val) => acc.concat(val), [] );
		var guilds = [];
		var channels = [];
		db.each( 'SELECT guild, channel FROM discord', [], (dberror, row) => {
			if ( dberror ) {
				console.log( '- Error while getting the setting: ' + dberror );
				return dberror;
			}
			if ( !row.channel && !all_guilds.includes(row.guild) ) {
				if ( row.guild in patreons ) client.shard.broadcastEval( `delete global.patreons['${row.guild}']` );
				if ( row.guild in voice ) delete voice[row.guild];
				return guilds.push(row.guild);
			}
			if ( row.channel && all_guilds.includes(row.guild) && !all_channels.includes(row.channel) ) return channels.push(row.channel);
		}, (error) => {
			if ( error ) {
				console.log( '- Error while getting the settings: ' + error );
				return error;
			}
			if ( guilds.length ) {
				db.run( 'DELETE FROM discord WHERE guild IN (' + guilds.map( guild => '?' ).join(', ') + ')', guilds, function (dberror) {
					if ( dberror ) {
						console.log( '- Error while removing the guilds: ' + dberror );
						return dberror;
					}
					console.log( '- Guilds successfully removed.' );
				} );
				db.run( 'DELETE FROM verification WHERE guild IN (' + guilds.map( guild => '?' ).join(', ') + ')', guilds, function (dberror) {
					if ( dberror ) {
						console.log( '- Error while removing the verifications: ' + dberror );
						return dberror;
					}
					console.log( '- Verifications successfully removed.' );
				} );
			}
			if ( channels.length ) db.run( 'DELETE FROM discord WHERE channel IN (' + channels.map( channel => '?' ).join(', ') + ')', channels, function (dberror) {
				if ( dberror ) {
					console.log( '- Error while removing the channels: ' + dberror );
					return dberror;
				}
				console.log( '- Channels successfully removed.' );
			} );
			if ( !guilds.length && !channels.length ) console.log( '- Settings successfully removed.' );
		} );
	} );
}


client.on( 'error', error => log_error(error, true) );
client.on( 'warn', warning => log_warn(warning, false) );

client.login(process.env.token).catch( error => {
	log_error(error, true, 'LOGIN-');
	client.login(process.env.token).catch( error => {
		log_error(error, true, 'LOGIN-');
		client.login(process.env.token).catch( error => {
			log_error(error, true, 'LOGIN-');
			process.exit(1);
		} );
	} );
} );

if ( isDebug ) client.on( 'debug', debug => {
	if ( isDebug ) console.log( '- ' + shardId + ': Debug: ' + debug );
} );


function log_error(error, isBig = false, type = '') {
	var time = new Date(Date.now()).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin' });
	if ( isDebug ) {
		console.error( '--- ' + type + 'ERROR START ' + time + ' ---\n', error, '\n--- ' + type + 'ERROR END ' + time + ' ---' );
	} else {
		if ( isBig ) console.log( '--- ' + type + 'ERROR: ' + time + ' ---\n-', error );
		else console.log( '- ' + error.name + ': ' + error.message );
	}
}

function log_warn(warning, api = true) {
	if ( isDebug ) {
		console.warn( '--- Warning start ---\n' + util.inspect( warning ) + '\n--- Warning end ---' );
	} else {
		if ( api ) console.warn( '- Warning: ' + Object.keys(warning).join(', ') );
		else console.warn( '--- Warning ---\n' + util.inspect( warning ) );
	}
}

async function graceful(signal) {
	stop = true;
	console.log( '- ' + shardId + ': ' + signal + ': Preparing to close...' );
	setTimeout( async () => {
		console.log( '- ' + shardId + ': ' + signal + ': Destroying client...' );
		await client.destroy();
		await db.close( dberror => {
			if ( dberror ) {
				console.log( '- ' + shardId + ': ' + signal + ': Error while closing the database connection: ' + dberror );
				return dberror;
			}
			console.log( '- ' + shardId + ': ' + signal + ': Closed the database connection.' );
			process.exit(0);
		} );
	}, 1000 ).unref();
}

process.once( 'SIGINT', graceful );
process.once( 'SIGTERM', graceful );