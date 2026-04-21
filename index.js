const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits,
  Partials,
} = require("discord.js");

// ╔══════════════════════════════════════════════════════════════╗
//  OKINAWA TICKET — Bot Modmail
//  Modifie les valeurs ci-dessous avant de démarrer
// ╚══════════════════════════════════════════════════════════════╝
const CONFIG = {
  TOKEN: "TON_TOKEN_ICI",
  GUILD_ID: "TON_GUILD_ID",
  TICKET_CATEGORY_ID: null,   // ID catégorie tickets  (null = aucune)
  LOG_CHANNEL_ID: null,       // ID salon logs          (null = désactivé)
  STAFF_ROLE_ID: null,        // ID rôle staff          (null = pas de ping)
  PREFIX: "!",
  COLOR_MAIN: 0x5865f2,
  COLOR_SUCCESS: 0x57f287,
  COLOR_ERROR: 0xed4245,
  COLOR_USER: 0x5865f2,
  COLOR_STAFF: 0xfee75c,
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageTyping,
    GatewayIntentBits.DirectMessageReactions,
  ],
  partials: [
    Partials.Channel,  // REQUIS pour recevoir les DMs
    Partials.Message,
    Partials.User,
  ],
});

const activeTickets = new Map(); // Map<userId, channelId>

// ──────────────────────────────────────────────────────────────────────────────
// EMBEDS
// ──────────────────────────────────────────────────────────────────────────────

function embedOpen(user, firstMessage) {
  return new EmbedBuilder()
    .setTitle("📬  Nouveau Ticket — Okinawa")
    .setDescription(`**${user.tag}** a ouvert un ticket via message privé.`)
    .setColor(CONFIG.COLOR_MAIN)
    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: "👤 Utilisateur", value: `<@${user.id}> (\`${user.id}\`)`, inline: true },
      { name: "🕐 Ouvert le", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
      { name: "💬 Premier message", value: firstMessage?.slice(0, 1024) || "*aucun texte*", inline: false }
    )
    .setFooter({ text: "Okinawa Ticket • !reply <msg> • !close • !help" })
    .setTimestamp();
}

function embedUserMsg(user, content, attachments) {
  const e = new EmbedBuilder()
    .setAuthor({ name: `💌 ${user.tag}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
    .setDescription(content || "*aucun texte*")
    .setColor(CONFIG.COLOR_USER)
    .setFooter({ text: `ID utilisateur : ${user.id}` })
    .setTimestamp();
  if (attachments.length)
    e.addFields({ name: "📎 Pièces jointes", value: attachments.map((a) => a.url).join("\n") });
  return e;
}

function embedStaffMsg(member, content, attachments) {
  const e = new EmbedBuilder()
    .setAuthor({ name: `✉️ ${member.user.tag} (Staff)`, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
    .setDescription(content || "*aucun texte*")
    .setColor(CONFIG.COLOR_STAFF)
    .setFooter({ text: "Okinawa Ticket • Réponse staff" })
    .setTimestamp();
  if (attachments.length)
    e.addFields({ name: "📎 Pièces jointes", value: attachments.map((a) => a.url).join("\n") });
  return e;
}

function embedConfirmUser() {
  return new EmbedBuilder()
    .setTitle("✅  Message reçu — Okinawa Ticket")
    .setDescription("Votre message a bien été reçu par notre staff.\nNous vous répondrons dans les plus brefs délais !")
    .setColor(CONFIG.COLOR_SUCCESS)
    .setFooter({ text: "Okinawa Ticket • Conservez ce DM ouvert" })
    .setTimestamp();
}

function embedUserClose() {
  return new EmbedBuilder()
    .setTitle("🔒  Ticket Fermé — Okinawa Ticket")
    .setDescription("Votre ticket a été fermé par le staff.\nN'hésitez pas à nous recontacter si besoin !")
    .setColor(CONFIG.COLOR_ERROR)
    .setFooter({ text: "Okinawa Ticket" })
    .setTimestamp();
}

function embedClose(closedBy) {
  return new EmbedBuilder()
    .setTitle("🔒  Ticket Fermé")
    .setDescription(`Fermé par **${closedBy.user?.tag ?? closedBy.tag}**.\nSuppression dans 3 secondes...`)
    .setColor(CONFIG.COLOR_ERROR)
    .setFooter({ text: "Okinawa Ticket" })
    .setTimestamp();
}

function embedHelp() {
  return new EmbedBuilder()
    .setTitle("📖  Okinawa Ticket — Aide Staff")
    .setColor(CONFIG.COLOR_MAIN)
    .addFields(
      { name: "`!reply <message>`", value: "Répondre à l'utilisateur du ticket.", inline: false },
      { name: "`!close`", value: "Fermer et supprimer ce ticket.", inline: false },
      { name: "`!tickets`", value: "Lister tous les tickets ouverts.", inline: false },
      { name: "`!info`", value: "Afficher les infos de l'utilisateur lié à ce ticket.", inline: false },
      { name: "`!help`", value: "Afficher ce message.", inline: false },
    )
    .setFooter({ text: "Okinawa Ticket" })
    .setTimestamp();
}

// ──────────────────────────────────────────────────────────────────────────────
// UTILS
// ──────────────────────────────────────────────────────────────────────────────

function safeChannelName(user) {
  return `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20)}-${user.id}`.slice(0, 100);
}

function getOwnerByChannel(channelId) {
  for (const [uid, cid] of activeTickets) if (cid === channelId) return uid;
  return null;
}

async function logAction(guild, text) {
  if (!CONFIG.LOG_CHANNEL_ID) return;
  const ch = guild.channels.cache.get(CONFIG.LOG_CHANNEL_ID);
  if (ch) await ch.send({ embeds: [new EmbedBuilder().setDescription(text).setColor(CONFIG.COLOR_MAIN).setTimestamp()] }).catch(() => {});
}

async function getOrCreateTicket(guild, user) {
  if (activeTickets.has(user.id)) {
    const ch = guild.channels.cache.get(activeTickets.get(user.id));
    if (ch) return { channel: ch, isNew: false };
    activeTickets.delete(user.id);
  }

  const overwrites = [
    { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles] },
  ];
  if (CONFIG.STAFF_ROLE_ID)
    overwrites.push({ id: CONFIG.STAFF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] });

  const opts = { name: safeChannelName(user), type: ChannelType.GuildText, topic: `Okinawa Ticket — ${user.tag} (${user.id})`, permissionOverwrites: overwrites };
  if (CONFIG.TICKET_CATEGORY_ID) opts.parent = CONFIG.TICKET_CATEGORY_ID;

  const channel = await guild.channels.create(opts);
  activeTickets.set(user.id, channel.id);
  return { channel, isNew: true };
}

// ──────────────────────────────────────────────────────────────────────────────
// EVENTS
// ──────────────────────────────────────────────────────────────────────────────

client.once("clientReady", () => {
  console.log(`\n✅  Okinawa Ticket prêt — connecté en tant que ${client.user.tag}`);
  console.log(`📡  Serveur cible : ${CONFIG.GUILD_ID}`);
  client.user.setActivity("vos messages privés 📬", { type: 3 });
});

client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;

    // ── DM reçu ──────────────────────────────────────────────────────────────
    if (message.channel.type === ChannelType.DM) {
      const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
      if (!guild) return console.error("❌  GUILD_ID introuvable ! Vérifiez la config.");

      const { channel, isNew } = await getOrCreateTicket(guild, message.author);

      if (isNew) {
        const ping = CONFIG.STAFF_ROLE_ID ? `<@&${CONFIG.STAFF_ROLE_ID}>` : "";
        await channel.send({ content: ping || undefined, embeds: [embedOpen(message.author, message.content)] });
        await message.author.send({ embeds: [embedConfirmUser()] }).catch(() => {});
        await logAction(guild, `📬 Ticket ouvert par <@${message.author.id}> → <#${channel.id}>`);
      } else {
        await channel.send({ embeds: [embedUserMsg(message.author, message.content, [...message.attachments.values()])] });
      }
      return;
    }

    // ── Commandes staff ───────────────────────────────────────────────────────
    if (!message.content.startsWith(CONFIG.PREFIX)) return;

    const args = message.content.slice(CONFIG.PREFIX.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();
    const ownerId = getOwnerByChannel(message.channel.id);

    // !help — disponible partout
    if (cmd === "help") return message.reply({ embeds: [embedHelp()] });

    // !tickets — disponible partout
    if (cmd === "tickets") {
      const list = [...activeTickets.entries()].map(([u, c]) => `• <@${u}> → <#${c}>`).join("\n") || "*Aucun ticket ouvert.*";
      return message.reply({ embeds: [new EmbedBuilder().setTitle(`📋  Tickets ouverts (${activeTickets.size})`).setDescription(list).setColor(CONFIG.COLOR_MAIN).setFooter({ text: "Okinawa Ticket" }).setTimestamp()] });
    }

    // Commandes qui nécessitent un salon ticket
    if (!ownerId) return;

    const user = await client.users.fetch(ownerId).catch(() => null);

    // !reply
    if (cmd === "reply") {
      const content = args.join(" ");
      if (!content && message.attachments.size === 0)
        return message.reply({ embeds: [new EmbedBuilder().setDescription("❌  Écris un message après `!reply`.").setColor(CONFIG.COLOR_ERROR)] });
      if (!user)
        return message.reply({ embeds: [new EmbedBuilder().setDescription("❌  Utilisateur introuvable.").setColor(CONFIG.COLOR_ERROR)] });

      await user.send({ embeds: [embedStaffMsg(message.member, content, [...message.attachments.values()])] }).catch(() => {});
      await message.channel.send({ embeds: [embedStaffMsg(message.member, content, [...message.attachments.values()])] });
      await message.delete().catch(() => {});
      await logAction(message.guild, `✉️ Réponse de **${message.author.tag}** à <@${ownerId}>`);
      return;
    }

    // !close
    if (cmd === "close") {
      if (user) await user.send({ embeds: [embedUserClose()] }).catch(() => {});
      await message.channel.send({ embeds: [embedClose(message.member)] });
      await logAction(message.guild, `🔒 Ticket de <@${ownerId}> fermé par **${message.author.tag}**`);
      activeTickets.delete(ownerId);
      setTimeout(() => message.channel.delete().catch(() => {}), 3000);
      return;
    }

    // !info
    if (cmd === "info") {
      if (!user) return message.reply({ embeds: [new EmbedBuilder().setDescription("❌  Utilisateur introuvable.").setColor(CONFIG.COLOR_ERROR)] });
      const member = await message.guild.members.fetch(user.id).catch(() => null);
      const embed = new EmbedBuilder()
        .setTitle("👤  Infos Utilisateur")
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .setColor(CONFIG.COLOR_MAIN)
        .addFields(
          { name: "Tag", value: user.tag, inline: true },
          { name: "ID", value: user.id, inline: true },
          { name: "Compte créé", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:D>`, inline: true },
          { name: "Sur le serveur", value: member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : "*Non membre*", inline: true },
          { name: "Rôles", value: member ? member.roles.cache.filter((r) => r.id !== message.guild.id).map((r) => r.toString()).join(", ") || "*aucun*" : "*N/A*", inline: false }
        )
        .setFooter({ text: "Okinawa Ticket" })
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

  } catch (err) {
    console.error("Erreur:", err);
  }
});

// Nettoyage si salon supprimé manuellement
client.on("channelDelete", (channel) => {
  for (const [uid, cid] of activeTickets) {
    if (cid === channel.id) { activeTickets.delete(uid); break; }
  }
});

// ──────────────────────────────────────────────────────────────────────────────
client.login(CONFIG.TOKEN).catch((err) => {
  console.error("❌  Connexion impossible :", err.message);
  console.error("👉  Vérifie que TOKEN est correct dans la config.");
  process.exit(1);
});
