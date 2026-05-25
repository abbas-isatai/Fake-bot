import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  AttachmentBuilder,
  ChatInputCommandInteraction,
  GuildMember,
  ApplicationIntegrationType,
  InteractionContextType,
  DiscordAPIError,
} from "discord.js";
import { createServer } from "http";
import { generateFakeMessage, type ReplyTo, type Reaction } from "./image-generator.js";

// Keep-alive HTTP server — lets external pingers (UptimeRobot etc.) hit /ping
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK");
}).listen(PORT, () => console.log(`Keep-alive server listening on port ${PORT}`));

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("Missing DISCORD_BOT_TOKEN environment variable");
  process.exit(1);
}

const rest = new REST().setToken(token);

const INSTALL = {
  integrationTypes: [ApplicationIntegrationType.UserInstall],
  contexts: [
    InteractionContextType.Guild,
    InteractionContextType.BotDM,
    InteractionContextType.PrivateChannel,
  ],
};

function buildCommands(prefix: string, label: string) {
  return [
    new SlashCommandBuilder()
      .setName(`${prefix}fake`)
      .setDescription(`Generate a fake ${label} Discord message`)
      .setIntegrationTypes(...INSTALL.integrationTypes)
      .setContexts(...INSTALL.contexts)
      .addUserOption((o) => o.setName("user").setDescription("User to impersonate").setRequired(true))
      .addStringOption((o) => o.setName("message").setDescription("What they supposedly said").setRequired(true))
      .toJSON(),

    new SlashCommandBuilder()
      .setName(`${prefix}edited`)
      .setDescription(`Generate a fake ${label} edited message`)
      .setIntegrationTypes(...INSTALL.integrationTypes)
      .setContexts(...INSTALL.contexts)
      .addUserOption((o) => o.setName("user").setDescription("User to impersonate").setRequired(true))
      .addStringOption((o) => o.setName("message").setDescription("The fake message content").setRequired(true))
      .toJSON(),

    new SlashCommandBuilder()
      .setName(`${prefix}react`)
      .setDescription(`Generate a fake ${label} message with emoji reactions`)
      .setIntegrationTypes(...INSTALL.integrationTypes)
      .setContexts(...INSTALL.contexts)
      .addUserOption((o) => o.setName("user").setDescription("User to impersonate").setRequired(true))
      .addStringOption((o) => o.setName("message").setDescription("The fake message content").setRequired(true))
      .addStringOption((o) =>
        o.setName("reactions").setDescription("Reactions, e.g: 👍 42, 😂 13, 🔥 (count optional)").setRequired(true)
      )
      .toJSON(),

    new SlashCommandBuilder()
      .setName(`${prefix}reply`)
      .setDescription(`Generate a fake ${label} reply to another user's message`)
      .setIntegrationTypes(...INSTALL.integrationTypes)
      .setContexts(...INSTALL.contexts)
      .addUserOption((o) => o.setName("user").setDescription("User sending the reply").setRequired(true))
      .addStringOption((o) => o.setName("message").setDescription("What they replied").setRequired(true))
      .addUserOption((o) => o.setName("quoted_user").setDescription("User being replied to").setRequired(true))
      .addStringOption((o) => o.setName("quoted_message").setDescription("The original message being quoted").setRequired(true))
      .toJSON(),
  ];
}

const commands = [
  ...buildCommands("", "mobile"),   // /fake /edited /react /reply  → phone screenshot
  ...buildCommands("pc", "PC"),     // /pcfake /pcedited /pcreact /pcreply → desktop screenshot
];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));
client.on("error", (err) => console.error("Client error:", err));

client.once("clientReady", async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  try {
    await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
    console.log("Slash commands registered globally.");
  } catch (err) {
    console.error("Failed to register slash commands:", err);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = interaction.commandName;
  const base = cmd.startsWith("pc") ? cmd.slice(2) : cmd;
  if (base === "fake")        await handleFake(interaction, false);
  else if (base === "edited") await handleFake(interaction, true);
  else if (base === "react")  await handleReact(interaction);
  else if (base === "reply")  await handleReply(interaction);
});

interface DiscordUserPayload {
  id: string;
  username: string;
  global_name?: string;
  discriminator: string;
  avatar?: string;
  clan?: { identity_guild_id: string; tag: string; badge: string };
}

async function resolveUserInfo(interaction: ChatInputCommandInteraction, optionName: string) {
  const targetUser = interaction.options.getUser(optionName, true);

  let displayName = targetUser.globalName ?? targetUser.username;
  let usernameColor: string | undefined;
  let roleName: string | undefined;
  let roleColor: string | undefined;
  const discriminator = targetUser.discriminator;

  let clanTag: string | undefined;
  let clanBadgeUrl: string | undefined;
  try {
    const profile = await rest.get(Routes.user(targetUser.id)) as DiscordUserPayload;
    if (profile.clan) {
      clanTag = profile.clan.tag;
      clanBadgeUrl = `https://cdn.discordapp.com/clan-badges/${profile.clan.identity_guild_id}/${profile.clan.badge}.png?size=16`;
    }
  } catch { /* unavailable */ }

  const avatarHash = targetUser.avatar;
  const avatarUrl = avatarHash?.startsWith("a_")
    ? `https://cdn.discordapp.com/avatars/${targetUser.id}/${avatarHash}.gif?size=128`
    : targetUser.displayAvatarURL({ size: 128, extension: "png" });

  if (interaction.guild) {
    try {
      const member = await interaction.guild.members.fetch(targetUser.id);
      if (member instanceof GuildMember) {
        displayName = member.displayName;
        const topRole = member.roles.cache
          .filter((r) => r.name !== "@everyone")
          .sort((a, b) => b.position - a.position)
          .first();
        if (topRole) {
          roleName = topRole.name;
          const hex = topRole.hexColor;
          if (hex && hex !== "#000000") { roleColor = hex; usernameColor = hex; }
        }
      }
    } catch { /* not in guild */ }
  }

  return { targetUser, displayName, discriminator, avatarUrl, usernameColor, roleName, roleColor, clanTag, clanBadgeUrl };
}

function parseReactions(raw: string): Reaction[] {
  return raw.split(",").map((part) => {
    const trimmed = part.trim();
    const match = trimmed.match(/^(.+?)\s+(\d+)$/);
    if (match) {
      return { emoji: match[1].trim(), count: parseInt(match[2], 10) };
    }
    return { emoji: trimmed, count: Math.floor(Math.random() * 20) + 1 };
  }).filter((r) => r.emoji.length > 0);
}

async function safeDefer(interaction: ChatInputCommandInteraction): Promise<boolean> {
  try {
    await interaction.deferReply();
    return true;
  } catch (err) {
    if (err instanceof DiscordAPIError && err.code === 10062) return false;
    throw err;
  }
}

async function sendImage(interaction: ChatInputCommandInteraction, buffer: Buffer) {
  const attachment = new AttachmentBuilder(buffer, { name: "fake-message.png" });
  try {
    await interaction.editReply({ files: [attachment] });
  } catch { /* interaction expired */ }
}

async function handleFake(interaction: ChatInputCommandInteraction, edited: boolean) {
  if (!await safeDefer(interaction)) return;
  try {
    const info = await resolveUserInfo(interaction, "user");
    const message = interaction.options.getString("message", true);
    const buffer = await generateFakeMessage({ ...info, username: info.displayName, message, edited });
    await sendImage(interaction, buffer);
  } catch (err) {
    console.error("Error in fake/edited:", err);
    try { await interaction.editReply("Something went wrong. Please try again."); } catch { /* expired */ }
  }
}

async function handleReact(interaction: ChatInputCommandInteraction) {
  if (!await safeDefer(interaction)) return;
  try {
    const info = await resolveUserInfo(interaction, "user");
    const message = interaction.options.getString("message", true);
    const reactions = parseReactions(interaction.options.getString("reactions", true));
    const buffer = await generateFakeMessage({ ...info, username: info.displayName, message, reactions });
    await sendImage(interaction, buffer);
  } catch (err) {
    console.error("Error in react:", err);
    try { await interaction.editReply("Something went wrong. Please try again."); } catch { /* expired */ }
  }
}

async function handleReply(interaction: ChatInputCommandInteraction) {
  if (!await safeDefer(interaction)) return;
  try {
    const info = await resolveUserInfo(interaction, "user");
    const message = interaction.options.getString("message", true);
    const quotedInfo = await resolveUserInfo(interaction, "quoted_user");
    const quotedMessage = interaction.options.getString("quoted_message", true);
    const replyTo: ReplyTo = {
      username: quotedInfo.displayName,
      avatarUrl: quotedInfo.avatarUrl,
      message: quotedMessage,
      usernameColor: quotedInfo.usernameColor,
    };
    const buffer = await generateFakeMessage({ ...info, username: info.displayName, message, replyTo });
    await sendImage(interaction, buffer);
  } catch (err) {
    console.error("Error in reply:", err);
    try { await interaction.editReply("Something went wrong. Please try again."); } catch { /* expired */ }
  }
}

client.login(token);
