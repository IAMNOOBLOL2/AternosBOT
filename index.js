const mineflayer = require('mineflayer');
const { Movements, pathfinder, goals } = require('mineflayer-pathfinder');
const { GoalBlock } = goals;
const config = require('./settings.json');
const express = require('express');
const app = express();
const PORT = 8000;

app.get('/', (_, res) => res.send('Bot is alive'));
app.listen(PORT, () => console.log(`Bot has arrived at http://localhost:${PORT}`));

let bot;
let currentIndex = 0;
let isKicked = false;

function createBot(account) {
  console.log(`[BOT] Connexion avec ${account.username}`);
  bot = mineflayer.createBot({
    username: account.username,
    password: account.password,
    auth: account.auth,
    host: config.server.ip,
    port: config.server.port,
    version: config.server.version,
  });

  isKicked = false;

  bot.loadPlugin(pathfinder);
  const mcData = require('minecraft-data')(bot.version);
  const defaultMove = new Movements(bot, mcData);
  let pendingPromise = Promise.resolve();

  function sendRegister(password) {
    return new Promise((resolve, reject) => {
      bot.chat(`/register ${password} ${password}`);
      bot.once('chat', (username, message) => {
        if (message.includes('successfully registered') || message.includes('already registered')) resolve();
        else reject(`Register failed: ${message}`);
      });
    });
  }

  function sendLogin(password) {
    return new Promise((resolve, reject) => {
      bot.chat(`/login ${password}`);
      bot.once('chat', (username, message) => {
        if (message.includes('successfully logged in')) resolve();
        else reject(`Login failed: ${message}`);
      });
    });
  }

  bot.once('spawn', () => {
    console.log(`[SPAWN] ${account.username} connecté.`);

    if (config.utils['skin-pseudo']) {
      bot.chat(`/skin set ${config.utils['skin-pseudo']}`);
    }

    if (config.utils['auto-auth'].enabled) {
      const password = config.utils['auto-auth'].password;
      pendingPromise = pendingPromise
        .then(() => sendRegister(password))
        .then(() => sendLogin(password))
        .catch(console.error);
    }

    if (config.utils['chat-messages'].enabled) {
      const messages = config.utils['chat-messages'].messages;
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

    if (config.position.enabled) {
      const pos = config.position;
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new GoalBlock(pos.x, pos.y, pos.z));
    }

    if (config.utils['anti-afk'].enabled) {
      setInterval(() => {
        if (!bot || !bot.entity) return;
        if (config.utils['anti-afk'].sneak) {
          bot.setControlState('sneak', true);
          setTimeout(() => bot.setControlState('sneak', false), 500);
        }
        if (config.utils['anti-afk'].move) {
          bot.setControlState('forward', true);
          setTimeout(() => {
            bot.setControlState('forward', false);
            bot.setControlState('back', true);
            setTimeout(() => bot.setControlState('back', false), 500);
          }, 500);
        }
        if (config.utils['anti-afk'].swing) bot.swingArm();
        if (config.utils['anti-afk'].jump) {
          bot.setControlState('jump', true);
          setTimeout(() => bot.setControlState('jump', false), 200);
        }
      }, 1000);
    }

    bot.on('chat', (username, message) => {
      if (username !== bot.username) {
        console.log(`[CHAT] ${username}: ${message}`);
      }
    });

    bot.on('message', (jsonMsg) => {
      const text = jsonMsg.toString();
      console.log(`[MSG] ${text}`);
    });

    bot.on('goal_reached', () => {
      const pos = bot.entity ? bot.entity.position : { x: '?', y: '?', z: '?' };
      console.log(`[GOAL] At X:${pos.x} Y:${pos.y} Z:${pos.z}`);
    });

    bot.on('death', () => {
      console.log(`[INFO] Bot ${account.username} is dead.`);
    });
  });

  // Supprime toute reconnexion automatique après déconnexion
  bot.on('end', () => {
    console.log(`[END] Bot ${account.username} disconnected.`);
    if (!isKicked && config.utils['auto-reconnect']) {
      setTimeout(() => createBot(account), config.utils['auto-recconect-delay']);
    } else {
      console.log(`[INFO] Pas de reconnexion (isKicked=${isKicked}).`);
    }
  });

  bot.on('kicked', reason => console.log(`[KICKED] ${reason}`));
  bot.on('error', err => console.log(`[ERROR] ${err.message}`));
}

function rotateBot() {
  if (bot) {
    console.log(`[ROTATE] Déconnexion de ${bot.username}...`);
    isKicked = true;
    bot.quit("Rotation vers un autre compte");
  }

  currentIndex = (currentIndex + 1) % config.accounts.length;
  const nextAccount = config.accounts[currentIndex];

  setTimeout(() => {
    console.log(`[ROTATE] Connexion avec ${nextAccount.username}...`);
    createBot(nextAccount);
  }, 2000); // Délai pour éviter un conflit
}

function startRotationSystem() {
  createBot(config.accounts[currentIndex]);

  const delayMs = config.rotationDelayMinutes * 60 * 1000;
  setInterval(() => {
    rotateBot();
  }, delayMs);
}

startRotationSystem();
