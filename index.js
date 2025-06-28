const mineflayer = require('mineflayer');
const Movements = require('mineflayer-pathfinder').Movements;
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const { GoalBlock } = require('mineflayer-pathfinder').goals;
const config = require('./settings.json');
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Bot has arrived');
});

app.listen(8000, () => {
  console.log('Server started');
});

function createBot() {
  const bot = mineflayer.createBot({
    username: config['bot-account']['username'],
    password: config['bot-account']['password'],
    auth: config['bot-account']['type'],
    host: config.server.ip,
    port: config.server.port,
    version: config.server.version,
  });

  bot.loadPlugin(pathfinder);
  const mcData = require('minecraft-data')(bot.version);
  const defaultMove = new Movements(bot, mcData);
  bot.settings.colorsEnabled = false;

  let pendingPromise = Promise.resolve();

  function sendRegister(password) {
    return new Promise((resolve, reject) => {
      bot.chat(`/register ${password} ${password}`);
      console.log(`[Auth] Sent /register command.`);
      bot.once('chat', (username, message) => {
        console.log(`[ChatLog] <${username}> ${message}`);
        if (message.includes('successfully registered')) {
          resolve();
        } else if (message.includes('already registered')) {
          resolve();
        } else {
          reject(`Register failed: ${message}`);
        }
      });
    });
  }

  function sendLogin(password) {
    return new Promise((resolve, reject) => {
      bot.chat(`/login ${password}`);
      console.log(`[Auth] Sent /login command.`);
      bot.once('chat', (username, message) => {
        console.log(`[ChatLog] <${username}> ${message}`);
        if (message.includes('successfully logged in')) {
          resolve();
        } else {
          reject(`Login failed: ${message}`);
        }
      });
    });
  }

  bot.once('spawn', () => {
    console.log('\x1b[33m[AfkBot] Bot joined the server\x1b[0m');

    // ✅ Skin via SkinRestorer
    const skinPseudo = config.utils['skin-pseudo'];
    if (skinPseudo && skinPseudo.length > 0) {
      bot.chat(`/skin set ${skinPseudo}`);
      console.log(`[Skin] Skin set to ${skinPseudo}`);
    }

    if (config.utils['auto-auth'].enabled) {
      const password = config.utils['auto-auth'].password;
      pendingPromise = pendingPromise
        .then(() => sendRegister(password))
        .then(() => sendLogin(password))
        .catch(error => console.error('[ERROR]', error));
    }

    if (config.utils['chat-messages'].enabled) {
      const messages = config.utils['chat-messages']['messages'];
      if (config.utils['chat-messages'].repeat) {
        const delay = config.utils['chat-messages']['repeat-delay'];
        let i = 0;
        setInterval(() => {
          bot.chat(messages[i]);
          i = (i + 1) % messages.length;
        }, delay * 1000);
      } else {
        messages.forEach(msg => bot.chat(msg));
      }
    }

    const pos = config.position;
    if (config.position.enabled) {
      console.log(`\x1b[32m[AfkBot] Moving to (${pos.x}, ${pos.y}, ${pos.z})\x1b[0m`);
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new GoalBlock(pos.x, pos.y, pos.z));
    }

    if (config.utils['anti-afk'].enabled) {
      if (config.utils['anti-afk'].sneak) {
        bot.setControlState('sneak', true);
      }

      if (config.utils['anti-afk'].swing) {
        setInterval(() => {
          if (bot && bot.entity) {
            bot.swingArm();
          }
        }, 1000);
      }
    }
  });

  // ✅ Commandes avec permissions
  const PREFIX = '!';
  const authorizedUsers = ['GeekAChad'];

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;

    if (message.startsWith(PREFIX)) {
      if (!authorizedUsers.includes(username)) {
        bot.chat(`§cTu n'as pas la permission, ${username}.`);
        console.log(`[DENIED] ${username} a tenté d'utiliser une commande.`);
        return;
      }

      const command = message.slice(PREFIX.length).trim();
      bot.chat('/' + command);
      console.log(`[COMMAND] ${username} a exécuté /${command}`);
    }
  });

  bot.on('goal_reached', () => {
    console.log(`\x1b[32m[AfkBot] Bot arrived at target: ${bot.entity.position}\x1b[0m`);
  });

  bot.on('death', () => {
    console.log(`\x1b[33m[AfkBot] Bot died and respawned at ${bot.entity.position}\x1b[0m`);
  });

  if (config.utils['auto-reconnect']) {
    bot.on('end', () => {
      setTimeout(() => {
        createBot();
      }, config.utils['auto-recconect-delay']);
    });
  }

  bot.on('kicked', (reason) => {
    console.log('\x1b[33m', `[AfkBot] Bot was kicked. Reason:\n${reason}`, '\x1b[0m');
  });

  bot.on('error', (err) => {
    console.log(`\x1b[31m[ERROR] ${err.message}`, '\x1b[0m');
  });
}

createBot();
