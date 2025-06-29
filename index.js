const mineflayer = require('mineflayer');
const Movements = require('mineflayer-pathfinder').Movements;
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const { GoalBlock } = require('mineflayer-pathfinder').goals;
const config = require('./settings.json');
const discordToken = process.env.DISCORD_BOT_TOKEN;

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

const startTime = Date.now();

let bot; // Mineflayer bot global
let isKicked = false; // pour gérer si on doit reconnecter ou non

function createBot() {
  bot = mineflayer.createBot({
    username: config['bot-account']['username'],
    password: config['bot-account']['password'],
    auth: config['bot-account']['type'],
    host: config.server.ip,
    port: config.server.port,
    version: config.server.version,
  });

  isKicked = false; // reset à chaque création de bot

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

  // Fonction pour envoyer TOUS les messages Minecraft dans le salon Discord configuré
  function sendMinecraftMessageToDiscord(msg) {
    const channelId = config.utils.discord.logChannelId;
    const channel = discordClient.channels.cache.get(channelId);
    if (!channel) {
      console.error('Salon Discord de logs introuvable (vérifie logChannelId dans settings.json)');
      return;
    }
    channel.send(msg).catch(console.error);
  }

  bot.once('spawn', () => {
    if (config.utils['skin-pseudo']) bot.chat(`/skin set ${config.utils['skin-pseudo']}`);

    if (config.utils['auto-auth'].enabled) {
      const password = config.utils['auto-auth'].password;
      pendingPromise = pendingPromise
        .then(() => sendRegister(password))
        .then(() => sendLogin(password))
        .catch(console.error);
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
      } else messages.forEach(msg => bot.chat(msg));
    }

    if (config.position.enabled) {
      const pos = config.position;
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new GoalBlock(pos.x, pos.y, pos.z));
    }

    if (config.utils['anti-afk'].enabled) {
      setInterval(() => {
        if (!bot || !bot.entity) return; // Evite erreur si bot non prêt

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

    const PREFIX = '!';
    const authorizedUsers = ['GeekAChad'];

    function safeUsername(name) {
      return name.replace(/[^a-zA-Z0-9_]/g, '');
    }

    // 1. Chat normal joueurs -> Discord
    bot.on('chat', (username, message) => {
      if (username === bot.username) return;
      const cleanName = safeUsername(username);
      sendMinecraftMessageToDiscord(`**${cleanName}**: ${message}`);

      // Commandes prefixées par '!' dans le chat Minecraft
      if (message.startsWith(PREFIX)) {
        if (!authorizedUsers.includes(username)) {
          bot.chat(`Pas autorisé: ${cleanName}`);
          return;
        }
        const command = message.slice(PREFIX.length).trim();
        bot.chat('/' + command);
        bot.chat(`Commande exécutée par ${cleanName}`);
        sendMinecraftMessageToDiscord(`Commande Minecraft : \`${command}\` par ${cleanName}`);
      }
    });

    // 2. Messages système / texte JSON du serveur -> Discord
    bot.on('message', (jsonMsg) => {
      const text = jsonMsg.toString();
      sendMinecraftMessageToDiscord(`[SYSTÈME] ${text}`);
    });

    // 3. Quand le bot atteint un objectif
    bot.on('goal_reached', () => {
      const pos = bot.entity ? bot.entity.position : { x: '?', y: '?', z: '?' };
      const msg = `[AfkBot] Objectif atteint à X:${pos.x} Y:${pos.y} Z:${pos.z}`;
      console.log(msg);
      sendMinecraftMessageToDiscord(msg);
    });

    // 4. Quand le bot meurt
    bot.on('death', () => {
      const msg = `[AfkBot] Le bot est mort.`;
      console.log(msg);
      sendMinecraftMessageToDiscord(msg);
    });
  });

  if (config.utils['auto-reconnect']) {
    bot.on('end', () => {
      sendMinecraftMessageToDiscord('[CONNEXION] Déconnecté du serveur Minecraft.');
      if (!isKicked) {
        setTimeout(() => {
          createBot();
        }, config.utils['auto-recconect-delay']);
      } else {
        console.log("[AfkBot] Bot déconnecté manuellement, pas de reconnexion.");
      }
    });
  }

  bot.on('kicked', (reason) => {
    const msg = `[KICKED] Raison: ${reason}`;
    console.log(msg);
    sendMinecraftMessageToDiscord(msg);
  });

  bot.on('error', (err) => {
    const msg = `[ERREUR] ${err.message}`;
    console.log(msg);
    sendMinecraftMessageToDiscord(msg);
  });
}

// Création du bot Minecraft
createBot();

// --- Discord Bot ---

const rest = new REST({ version: '10' }).setToken(config.utils.discord.token);

const commands = [
  new SlashCommandBuilder()
    .setName('commande')
    .setDescription('Exécute une commande Minecraft via le bot')
    .addStringOption(option =>
      option.setName('texte')
        .setDescription('Commande Minecraft à exécuter')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Affiche le nom du bot et le temps de connexion'),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Déconnecte le bot Minecraft sans reconnexion'),

  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Fait reconnecter le bot Minecraft au serveur')
];

async function registerCommands() {
  try {
    console.log('Enregistrement des commandes slash Discord...');
    await rest.put(
      Routes.applicationGuildCommands(config.utils.discord.clientId, config.utils.discord.guildId),
      { body: commands.map(command => command.toJSON()) }
    );
    console.log('Commandes enregistrées.');
  } catch (error) {
    console.error('Erreur en enregistrant les commandes :', error);
  }
}

registerCommands();

discordClient.on('ready', () => {
  console.log(`[Discord Bot] Connecté en tant que ${discordClient.user.tag}`);
});

discordClient.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  if (interaction.commandName === 'commande') {
    const texte = interaction.options.getString('texte');

    if (!bot || !bot.entity) {
      return interaction.reply({ content: 'Le bot Minecraft n\'est pas connecté ou pas prêt.', ephemeral: true });
    }

    bot.chat(texte);
    await interaction.reply({ content: `Commande envoyée : \`${texte}\`` });
  } 
  else if (interaction.commandName === 'help') {
    const duration = Math.floor((Date.now() - startTime) / 1000);
    const uptime = `${Math.floor(duration / 3600)}h ${Math.floor((duration % 3600) / 60)}m ${duration % 60}s`;
    const botName = config.utils.discord.botName || discordClient.user.username;

    await interaction.reply({
      embeds: [{
        title: botName,
        description: `Connecté depuis : **${uptime}**`,
        color: 0x800080 // violet
      }]
    });
  } 
  else if (interaction.commandName === 'kick') {
    if (!bot) {
      return interaction.reply({ content: 'Le bot Minecraft n\'est pas connecté.', ephemeral: true });
    }
    isKicked = true;
    bot.quit('Bot déconnecté manuellement via commande /kick');
    await interaction.reply({ content: 'Bot Minecraft déconnecté sans reconnexion.' });
  }
  else if (interaction.commandName === 'join') {
    if (bot && bot.connected) {
      return interaction.reply({ content: 'Le bot est déjà connecté.', ephemeral: true });
    }
    createBot();
    await interaction.reply({ content: 'Bot Minecraft est en train de se connecter...' });
  }
});

function sendDiscordMessage(content) {
  const channelId = config.utils.discord.channelId;
  const channel = discordClient.channels.cache.get(channelId);
  if (!channel) return console.error('Salon Discord introuvable');
  channel.send(content).catch(console.error);
}

discordClient.login(discordToken);

