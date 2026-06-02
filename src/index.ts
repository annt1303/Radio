import 'dotenv/config';

// Đảm bảo ffmpeg-static được load trước khi @discordjs/voice khởi tạo
import ffmpegPath from 'ffmpeg-static';
if (ffmpegPath) {
  process.env.FFMPEG_PATH = ffmpegPath;
}

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Client,
  ComponentType,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  Message,
} from 'discord.js';
import { generateDependencyReport } from '@discordjs/voice';
import {
  handlePlay,
  handleSkip,
  handlePause,
  handleResume,
  handleStop,
  handleQueue,
  handleNowPlaying,
  handleHelp,
  fromButtonInteraction,
  fromInteraction,
  fromMessage,
  SearchPlatform,
} from './commands';
import { getOrCreateQueue } from './queue';
import { isSupportedLink } from './parser';

// ─── Cấu hình ──────────────────────────────────────────────────────────

const TOKEN = process.env.DISCORD_TOKEN!;
const CLIENT_ID = process.env.CLIENT_ID!;
const PREFIX = process.env.PREFIX || '!';

if (!TOKEN || TOKEN === 'YOUR_DISCORD_BOT_TOKEN_HERE') {
  console.error('❌ Vui lòng cấu hình DISCORD_TOKEN trong file .env');
  process.exit(1);
}
if (!CLIENT_ID || CLIENT_ID === 'YOUR_DISCORD_CLIENT_ID_HERE') {
  console.error('❌ Vui lòng cấu hình CLIENT_ID trong file .env');
  process.exit(1);
}

// ─── Định nghĩa Slash Commands ─────────────────────────────────────────

const slashCommands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Phát nhạc từ YouTube, SoundCloud hoặc Spotify')
    .addStringOption((opt) =>
      opt.setName('query').setDescription('Tên bài hát hoặc liên kết (URL)').setRequired(true)
    ),
  new SlashCommandBuilder().setName('skip').setDescription('Bỏ qua bài hát hiện tại'),
  new SlashCommandBuilder().setName('pause').setDescription('Tạm dừng phát nhạc'),
  new SlashCommandBuilder().setName('resume').setDescription('Tiếp tục phát nhạc'),
  new SlashCommandBuilder().setName('stop').setDescription('Dừng nhạc và rời kênh thoại'),
  new SlashCommandBuilder().setName('list').setDescription('Xem danh sách hàng đợi'),
  new SlashCommandBuilder().setName('nowplaying').setDescription('Xem bài hát đang phát'),
  new SlashCommandBuilder().setName('help').setDescription('Hướng dẫn sử dụng bot'),
];

function buildPlatformRow(ownerId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`play_platform:youtube:${ownerId}`)
      .setLabel('YouTube')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`play_platform:soundcloud:${ownerId}`)
      .setLabel('SoundCloud')
      .setStyle(ButtonStyle.Primary)
  );
}

function platformPromptEmbed(query: string): any {
  return {
    title: 'Chọn nền tảng tìm kiếm',
    description: `Bạn muốn tìm \`${query}\` trên nền tảng nào?`,
    color: 0xf1c40f,
  };
}

async function handlePlatformButton(button: ButtonInteraction, query: string): Promise<void> {
  const [, platform] = button.customId.split(':') as [string, SearchPlatform, string];
  await button.deferUpdate();

  const ctx = fromButtonInteraction(button);
  const queue = getOrCreateQueue(ctx.guildId);
  if (button.channel?.isTextBased()) {
    queue.textChannel = button.channel as any;
  }

  await handlePlay(ctx, query, platform);
}

async function askPlatformFromSlash(cmd: ChatInputCommandInteraction, query: string): Promise<void> {
  const row = buildPlatformRow(cmd.user.id);
  const reply = await cmd.reply({
    embeds: [platformPromptEmbed(query)],
    components: [row],
    fetchReply: true,
  });

  try {
    const button = await reply.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: 30_000,
      filter: (interaction) =>
        interaction.user.id === cmd.user.id &&
        interaction.customId.startsWith('play_platform:') &&
        interaction.customId.endsWith(`:${cmd.user.id}`),
    });
    await handlePlatformButton(button, query);
  } catch {
    await cmd.editReply({
      embeds: [{
        title: 'Đã hết thời gian chọn',
        description: 'Hãy dùng lại `/play` khi bạn muốn tìm bài.',
        color: 0x95a5a6,
      }],
      components: [],
    });
  }
}

async function askPlatformFromMessage(message: Message, query: string): Promise<void> {
  const row = buildPlatformRow(message.author.id);
  const prompt = await message.reply({
    embeds: [platformPromptEmbed(query)],
    components: [row],
  });

  try {
    const button = await prompt.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: 30_000,
      filter: (interaction) =>
        interaction.user.id === message.author.id &&
        interaction.customId.startsWith('play_platform:') &&
        interaction.customId.endsWith(`:${message.author.id}`),
    });
    await handlePlatformButton(button, query);
  } catch {
    await prompt.edit({
      embeds: [{
        title: 'Đã hết thời gian chọn',
        description: `Hãy dùng lại \`${PREFIX}p\` khi bạn muốn tìm bài.`,
        color: 0x95a5a6,
      }],
      components: [],
    });
  }
}

// ─── Đăng ký Slash Commands ─────────────────────────────────────────────

async function registerSlashCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    console.log('🔄 Đang đăng ký Slash Commands...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), {
      body: slashCommands.map((cmd) => cmd.toJSON()),
    });
    console.log('✅ Đã đăng ký Slash Commands thành công!');
  } catch (error) {
    console.error('❌ Lỗi khi đăng ký Slash Commands:', error);
  }
}

// ─── Tạo Discord Client ────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ─── Sự kiện: Bot sẵn sàng ─────────────────────────────────────────────

client.once(Events.ClientReady, async (readyClient) => {
  console.log('═══════════════════════════════════════════');
  console.log(`🎵 Bot nhạc đã sẵn sàng!`);
  console.log(`🤖 Đăng nhập với tên: ${readyClient.user.tag}`);
  console.log(`🌐 Đang phục vụ ${readyClient.guilds.cache.size} server(s)`);
  console.log(`📌 Prefix: ${PREFIX}`);
  console.log('═══════════════════════════════════════════');

  // In báo cáo dependencies
  console.log('\n📦 Dependency Report:');
  console.log(generateDependencyReport());

  // Đăng ký slash commands
  await registerSlashCommands();
});

// ─── Sự kiện: Xử lý Slash Commands ─────────────────────────────────────

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guildId) return;

  const cmd = interaction as ChatInputCommandInteraction;

  const ctx = fromInteraction(cmd);

  // Gán textChannel cho queue
  const queue = getOrCreateQueue(ctx.guildId);
  if (cmd.channel?.isTextBased()) {
    queue.textChannel = cmd.channel as any;
  }

  switch (cmd.commandName) {
    case 'play': {
      const query = cmd.options.getString('query', true);
      if (!isSupportedLink(query)) {
        await askPlatformFromSlash(cmd, query);
        return;
      }

      await cmd.deferReply();
      await handlePlay(ctx, query);
      break;
    }
    case 'skip':
      await cmd.deferReply();
      await handleSkip(ctx);
      break;
    case 'pause':
      await cmd.deferReply();
      await handlePause(ctx);
      break;
    case 'resume':
      await cmd.deferReply();
      await handleResume(ctx);
      break;
    case 'stop':
      await cmd.deferReply();
      await handleStop(ctx);
      break;
    case 'list':
      await cmd.deferReply();
      await handleQueue(ctx);
      break;
    case 'nowplaying':
      await cmd.deferReply();
      await handleNowPlaying(ctx);
      break;
    case 'help':
      await cmd.deferReply();
      await handleHelp(ctx, PREFIX);
      break;
  }
});

// ─── Sự kiện: Xử lý Prefix Commands (tin nhắn) ─────────────────────────

client.on(Events.MessageCreate, async (message: Message) => {
  // Bỏ qua tin nhắn từ bot hoặc không có prefix
  if (message.author.bot) return;
  if (!message.guildId) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();

  if (!command) return;

  const ctx = fromMessage(message);

  // Gán textChannel cho queue
  const queue = getOrCreateQueue(ctx.guildId);
  if (message.channel.isTextBased()) {
    queue.textChannel = message.channel as any;
  }

  switch (command) {
    case 'p':
    case 'play': {
      const query = args.join(' ');
      if (!query) {
        await message.reply(`❌ Vui lòng nhập tên bài hát hoặc liên kết. Ví dụ: \`${PREFIX}p Em Của Ngày Hôm Qua\``);
        return;
      }

      if (!isSupportedLink(query)) {
        await askPlatformFromMessage(message, query);
        return;
      }

      await handlePlay(ctx, query);
      break;
    }
    case 'skip':
    case 's':
      await handleSkip(ctx);
      break;
    case 'pause':
      await handlePause(ctx);
      break;
    case 'resume':
      await handleResume(ctx);
      break;
    case 'stop':
    case 'leave':
      await handleStop(ctx);
      break;
    case 'list':
    case 'l':
    case 'queue':
    case 'q':
      await handleQueue(ctx);
      break;
    case 'nowplaying':
    case 'np':
      await handleNowPlaying(ctx);
      break;
    case 'help':
    case 'h':
      await handleHelp(ctx, PREFIX);
      break;
  }
});

// ─── Khởi động bot ──────────────────────────────────────────────────────

client.login(TOKEN).catch((err) => {
  console.error('❌ Không thể đăng nhập vào Discord:', err);
  process.exit(1);
});
