const mineflayer = require('mineflayer');
const { Movements, pathfinder, goals } = require('mineflayer-pathfinder');
const { GoalBlock } = goals;
const express = require('express');
const config = require('./settings.json');

const app = express();
const PORT = 8000;

let bot;
let currentIndex = 0;
let isRotating = false;
let antiAfkInterval = null;

app.get('/', (_, res) => res.send('Bot is alive'));
app.listen(PORT, () => {
  console.log(`Bot HTTP server running at http://localhost:${PORT}`);
  startRotationSystem();
});

function createBot(account) {
  console.log(`[BOT] Connexion avec ${account.username}`);
  isRotating = false;

  bot = mineflayer.createBot({
    username: account.username,
    password: account.password,
    auth: account.auth,
    host: config.server.ip,
    port: config.server.port,
    version: config.server.version,
  });

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

    // Unban les autres bots
    if (Array.isArray(config.botUsernames)) {
      const others = config.botUsernames.filter(name => name !== account.username);
      for (let i = 0; i < 2; i++) {
        others.forEach(otherName => {
          bot.chat(`/pardon ${otherName}`);
        });
      }
    }

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
      antiAfkInterval = setInterval(() => {
        if (!bot || !bot.entity || bot._disableAntiafk) return;

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

  bot.on('end', () => {
    console.log(`[END] Bot ${account.username} disconnected.`);
    if (antiAfkInterval) clearInterval(antiAfkInterval);
    if (!isRotating) {
      console.log(`[INFO] Reconnexion de ${account.username} dans 10s...`);
      setTimeout(() => createBot(account), 10000);
    }
  });

  bot.on('kicked', reason => {
    console.log(`[KICKED] ${reason}`);
  });

  bot.on('error', err => {
    console.log(`[ERROR] ${err.message}`);
  });
}

function scheduleNextRotation() {
  const delayMs = (config.rotationDelaySeconds || 60) * 1000;

  // Désactivation anti-AFK 5s avant
  setTimeout(() => {
    if (bot) {
      console.log(`[ROTATION] Désactivation de l'anti-AFK de ${bot.username}`);
      bot._disableAntiafk = true;
    }
  }, delayMs - 5000);

  // Rotation après délai complet
  setTimeout(() => {
    rotateBot();
  }, delayMs);
}

function rotateBot() {
  if (bot) {
    console.log(`[ROTATE] Déconnexion de ${bot.username}...`);
    isRotating = true;
    bot.quit("Rotation vers un autre compte");
  }

  setTimeout(() => {
    currentIndex = (currentIndex + 1) % config.accounts.length;
    const nextAccount = config.accounts[currentIndex];
    console.log(`[ROTATE] Connexion avec ${nextAccount.username}`);
    createBot(nextAccount);
    scheduleNextRotation();
  }, 5000);
}

function startRotationSystem() {
  createBot(config.accounts[currentIndex]);
  scheduleNextRotation();
}
