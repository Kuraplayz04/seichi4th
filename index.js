const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const discord = require('discord.js');
const client = new discord.Client();
const ip = require("ip");
const { PORT, TOKEN, CHANNEL, CHANNEL2 } = require('./config.json');


const wss = new WebSocket.Server({ port: PORT });
client.login(TOKEN);
client.on('ready', () => {
  console.log(`${client.user.tag} でログインしています。`);
  client.channels.cache.get(CHANNEL).send('[log] 起動しました');
});

client.on('message', message => {
  if (message.author.bot) return;
  if (message.content === '.ping') {
    client.channels.cache.get(CHANNEL).send(`ping: ${client.ws.ping}`);
  }
  if (message.mentions.has(client.user)) {
    message.reply(`hi`)
  }

});


//時間取得用
function getTime() {
  let date = new Date();
  let hour = date.getHours();
  let minute = date.getMinutes();
  let second = date.getSeconds();
  hour = ('0' + hour).slice(-2);
  minute = ('0' + minute).slice(-2);
  second = ('0' + second).slice(-2);
  let time = hour + ':' + minute + ':' + second;
  return time;
}

//ユーザー発言時のイベント登録用JSON文字列を生成する関数
function event(name) {
  return JSON.stringify({
    "header": {
      "requestId": uuidv4(),
      "messagePurpose": "subscribe",
      "version": 1,
      "messageType": "commandRequest"
    },
    "body": {
      "eventName": name
    }
  });
}

//コマンドを実行するのに必要なやつ
function command(x) {
  return JSON.stringify({
    header: {
      requestId: uuidv4(),
      messagePurpose: "commandRequest",
      version: 1,
      messageType: "commandRequest"
    },
    body: {
      origin: {
        type: "player"
      },
      commandLine: x,
      version: 1
    }
  });
}

//コマンド実行からのコールバック
function callback() {
  return JSON.stringify({
    "body": {
      "statusCode": 0,
      "statusMessage": ""
    },
    "header": {
      "messagePurpose": "commandResponse",
      "requestId": uuidv4()
    }
  });
}

// マイクラ側からの接続時に呼び出される関数
wss.on('connection', ws => {
  ws.send(command(`tellraw @a {"rawtext":[{"text":"[log] ws://${ip.address()}:${PORT} との接続を開始しました"}]}`));
  console.log(`[log] ${ws._socket.remoteAddress}:${ws._socket.remotePort} との接続を開始しました`)
  client.channels.cache.get(CHANNEL).send(`[log] 接続を開始しました`);

  sendCmd('list', callback => {
    console.log(callback);
  });
  /*
  sendCmd('testforblock ~~~ air', callback => {
    console.log(callback);
  });
  */
  // ユーザー発言時のイベントをsubscribe
  ws.send(event('PlayerMessage'));
  ws.send(callback());
  ws.send(event('PlayerJoin'));
  ws.send(event('PlayerLeave'));

  // 各種イベント発生時に呼ばれる関数
  ws.on('message', packet => {
    const res = JSON.parse(packet);
    if (res.body.eventName == 'PlayerJoin' || res.body.eventName == 'PlayerLeave') {
      console.log(res);
    }
    if (res.body.eventName === 'PlayerMessage') {
      if (res.body.properties.MessageType == 'chat' && res.body.properties.Sender != '外部') {
        let Message = res.body.properties.Message;
        let Sender = res.body.properties.Sender;
        let sendTime = getTime();
        let chatMessage = `[Minecraft-${sendTime}] ${Sender} : ${Message}`;
        console.log(chatMessage);

        //minecraft->discord
        //@everyone,@hereが含まれていたら送信をブロック
        if (res.body.properties.Message.search(/(@everyone|@here)/) === -1) {
          client.channels.cache.get(CHANNEL).send(chatMessage);
        } else {
          ws.send(command(`tellraw ${Sender} {"rawtext":[{"text":"§4禁止語句が含まれているため送信をブロックしました。"}]}`));
        }
        /*
        if (res.body.properties.Message.startsWith('.close')) {
          ws.send(command('connect off'))
        }
        */
        if (res.body.properties.Message.startsWith('.list')) {
          sendCmd('list', callback => {
            let listMsg = `現在の人数: ${callback.currentPlayerCount}/${callback.maxPlayerCount}\nプレイヤー: ${callback.players}\n最終更新: ${getTime()}`
            client.channels.cache.get(CHANNEL).send({
              embed: {
                color: 16757683,
                description: listMsg
              }
            });
            ws.send(command(`tellraw @a {"rawtext":[{"text":"${listMsg}"}]}`));
          })
        }
      }
    }
  });

  ws.on('close', () => {
    console.log(`[log] 接続が終了しました`);
    client.channels.cache.get(CHANNEL).send(`[log] 接続が終了しました`);
  });

  //discord->minecraft
  client.on('message', message => {
    // メッセージが送信されたとき
    if (message.author.bot) return;
    if (message.channel.id == CHANNEL) {
      let sendTime = getTime();
      let logMessage = `[discord-${sendTime}] ${message.member.displayName} : ${message.content}`;
      console.log(logMessage);
      ws.send(command(`tellraw @a {"rawtext":[{"text":"§b${logMessage}"}]}`))
    }

    if (message.channel.id == CHANNEL && message.content == '.list') {
      sendCmd('list', callback => {
        let listMsg = `現在の人数: ${callback.currentPlayerCount}/${callback.maxPlayerCount}\nプレイヤー: ${callback.players}\n最終更新: ${getTime()}`
        client.channels.cache.get(CHANNEL).send({
          embed: {
            color: 16757683,
            description: listMsg
          }
        });
      });
    }
    
    //statコマンド
    if (message.channel.id == CHANNEL && message.content.startsWith('.stat ')) {
      let name = splitNicely(message.content);
      sendCmd(`scoreboard players test "${name[1]}" mine * *`, callback => {
        let str = callback.statusMessage.replace('スコア ', '');
        let mine = str.replace(' は -2147483648 ～ 2147483647 の範囲内です', '');
        sendCmd(`scoreboard players test "${name[1]}" level * *`, callback => {
          let str = callback.statusMessage.replace('スコア ', '');
          let level = str.replace(' は -2147483648 ～ 2147483647 の範囲内です', '');
          sendCmd(`scoreboard players test "${name[1]}" login * *`, callback => {
            let str = callback.statusMessage.replace('スコア ', '');
            let login = str.replace(' は -2147483648 ～ 2147483647 の範囲内です', '');
            
            let msg = `${name[1]} のステータス\n採掘量: ${mine}\nレベル: ${level}\nログイン時間: ${login}分\n\n最終更新: ${getTime()}`
            sendMsg(`§a${name[1]} のステータス§r\n採掘量: ${mine}\nレベル: ${level}\nログイン時間: ${login}分`)
            client.channels.cache.get(CHANNEL).send({
              embed: {
                color: 16757683,
                description: msg
              }
            });
          });
        });
      });
    }
    
    //discordからコマンド実行
    if (message.channel.id == CHANNEL2) {
        let logMessage = `[discord-${getTime()}] ${message.member.displayName} : ${message.content}`;
      if (message.content.startsWith('.')) {
        ws.send(command(`tellraw @a {"rawtext":[{"text":"§a${logMessage}"}]}`));
        var cmd = message.content.replace('.', '')
        sendCmd(cmd, callback => {
          let output = JSON.stringify(callback, null, 2);
          client.channels.cache.get(CHANNEL2).send({
            embed: {
              color: 16757683,
              description: output
            }
          });
        });
      } else {
        ws.send(command(`tellraw @a {"rawtext":[{"text":"§b${logMessage}"}]}`))
      }
    }
  });

  //人数をdiscordにリアルタイム表示
  setInterval(function() {
    sendCmd('list', callback => {
      let listMsg = `現在の人数: ${callback.currentPlayerCount}/${callback.maxPlayerCount}\nプレイヤー: ${callback.players}\n\n最終更新: ${getTime()}`
      let msg = client.channels.cache.get('881385592414416966').messages.fetch('881440275736723476')
      msg.then((value) => {
        value.edit(
          {embed: {
            color: 16757683,
            description: listMsg
          }}
        );
      });
    })
      
  },5000)

  //コールバック付きでコマンド実行
  function sendCmd(command, callback) {
    let uuid1 = uuidv4();
    let json = {
      header: {
        requestId: uuid1,
        messagePurpose: "commandRequest",
        version: 1,
        messageType: "commandRequest"
      },
      body: {
        origin: {
          type: "player"
        },
        commandLine: command,
        version: 1
      }
    };
    ws.send(JSON.stringify(json));
    ws.on('message', packet => {
      let data = JSON.parse(packet);
      if (data.header.messagePurpose === 'commandResponse' && data.header.requestId === uuid1) {
        callback(data.body);
      }
    });
  }
  
  //tellrawメッセージを送信
  function sendMsg(msg) {
    let json = {
      header: {
        requestId: uuidv4(),
        messagePurpose: "commandRequest",
        version: 1,
        messageType: "commandRequest"
      },
      body: {
        origin: {
          type: "player"
        },
        commandLine: `tellraw @a {"rawtext":[{"text":"${msg}"}]}`,
        version: 1
      }
    }
    ws.send(JSON.stringify(json));
  }

});

console.log(`Minecraft: /connect ${ip.address()}:${PORT}`)

/**
 * 文字列を半角スペースで区切る。ダブルクォートの内側は区切らない (エスケープされていれば区切る)。
 * @param  {String} str 文字列
 * @return {Array} 区切られた文字列の配列
 */
function splitNicely(str) {
	if (str !== String(str)) {
		return [str];
	}
	const arr = [];
	let buff = '';
	let escaped = false;
	let quoted = false;
	for (let i = 0, len = str.length; i < len; ++i) {
		const c = str.charAt(i);
		if (c === '\\') {
			escaped = true;
		} else {
			if (!escaped && c === '"') {
				const prev = str.charAt(i - 1);
				const next = str.charAt(i + 1);
				if (!quoted && (prev === '' || prev === ' ')) {
					quoted = true;
				} else if (quoted && (next === '' || next === ' ')) {
					quoted = false;
				} else {
					buff += c;
				}
			} else if (!quoted && c === ' ') {
				arr.push(buff);
				buff = '';
			} else {
				buff += c;
			}
			escaped = false;
		}
	}
	arr.push(buff);
	return arr;
}