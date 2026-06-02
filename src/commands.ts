import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  Message,
} from 'discord.js';
import { parseQuery, Track, formatDuration } from './parser';
import { getOrCreateQueue, getQueue, deleteQueue } from './queue';

// ─── Kiểu dữ liệu chung cho cả Slash và Prefix ────────────────────────

interface CommandContext {
  guildId: string;
  member: GuildMember;
  reply: (content: any) => Promise<void>;
}

export type SearchPlatform = 'youtube' | 'soundcloud';

// ─── Helpers ────────────────────────────────────────────────────────────

function buildEmbed(
  title: string,
  description: string,
  color: number,
  thumbnail?: string
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();

  if (thumbnail) embed.setThumbnail(thumbnail);
  return embed;
}

// ─── PLAY ───────────────────────────────────────────────────────────────

export async function handlePlay(
  ctx: CommandContext,
  query: string,
  platform: SearchPlatform = 'youtube'
): Promise<void> {
  // Kiểm tra người dùng có trong voice channel không
  if (!ctx.member.voice.channel) {
    await ctx.reply({
      embeds: [buildEmbed('❌ Lỗi', 'Bạn cần vào một **kênh thoại** trước khi phát nhạc!', 0xff0000)],
    });
    return;
  }

  const displayPlatform = query.includes('soundcloud.com') ? 'soundcloud' : platform;

  await ctx.reply({
    embeds: [buildEmbed('🔍 Đang tìm kiếm...', `\`${query}\` trên **${displayPlatform === 'youtube' ? 'YouTube' : 'SoundCloud'}**`, 0xf1c40f)],
  });

  try {
    const tracks = await parseQuery(query, ctx.member.displayName, platform);
    if (!tracks || tracks.length === 0) {
      await ctx.reply({
        embeds: [buildEmbed('❌ Không tìm thấy', `Không tìm thấy kết quả nào cho \`${query}\`.`, 0xff0000)],
      });
      return;
    }

    const queue = getOrCreateQueue(ctx.guildId);

    // Kết nối voice nếu chưa
    if (!queue.connection) {
      queue.join(ctx.member);
    }

    // Đặt text channel để gửi thông báo
    if (ctx.member.voice.channel) {
      const textChannel = ctx.member.voice.channel.guild.channels.cache.find(
        (ch) => ch.isTextBased() && ch.id === (ctx.member as any)._textChannelId
      );
    }

    queue.enqueue(tracks);

    if (tracks.length === 1) {
      const track = tracks[0];
      const sourceIcon = track.source === 'youtube' ? '🔴' : track.source === 'soundcloud' ? '🟠' : '🟢';
      await ctx.reply({
        embeds: [
          buildEmbed(
            '✅ Đã thêm vào hàng đợi',
            `${sourceIcon} [**${track.title}**](${track.url})\n⏱️ \`${track.duration}\` • Yêu cầu bởi **${track.requester}**\n📋 Vị trí: **#${queue.tracks.length}**`,
            0x2ecc71,
            track.thumbnail
          ),
        ],
      });
    } else {
      await ctx.reply({
        embeds: [
          buildEmbed(
            '✅ Đã thêm danh sách phát',
            `📋 Đã thêm **${tracks.length}** bài hát vào hàng đợi.\nBài đầu tiên: **${tracks[0].title}**`,
            0x2ecc71,
            tracks[0].thumbnail
          ),
        ],
      });
    }

    // Nếu không đang phát → bắt đầu phát
    if (!queue.isPlaying) {
      queue.processQueue();
    }
  } catch (error: any) {
    await ctx.reply({
      embeds: [buildEmbed('❌ Lỗi', error.message || 'Đã xảy ra lỗi khi xử lý yêu cầu.', 0xff0000)],
    });
  }
}

// ─── SKIP ───────────────────────────────────────────────────────────────

export async function handleSkip(ctx: CommandContext): Promise<void> {
  const queue = getQueue(ctx.guildId);
  if (!queue || !queue.current) {
    await ctx.reply({
      embeds: [buildEmbed('❌ Lỗi', 'Không có bài hát nào đang phát!', 0xff0000)],
    });
    return;
  }

  const skipped = queue.current.title;
  queue.skip();
  await ctx.reply({
    embeds: [buildEmbed('⏭️ Đã bỏ qua', `Đã bỏ qua: **${skipped}**`, 0xe67e22)],
  });
}

// ─── PAUSE ──────────────────────────────────────────────────────────────

export async function handlePause(ctx: CommandContext): Promise<void> {
  const queue = getQueue(ctx.guildId);
  if (!queue || !queue.current) {
    await ctx.reply({
      embeds: [buildEmbed('❌ Lỗi', 'Không có bài hát nào đang phát!', 0xff0000)],
    });
    return;
  }

  queue.pause();
  await ctx.reply({
    embeds: [buildEmbed('⏸️ Đã tạm dừng', `Đã tạm dừng: **${queue.current.title}**`, 0xf1c40f)],
  });
}

// ─── RESUME ─────────────────────────────────────────────────────────────

export async function handleResume(ctx: CommandContext): Promise<void> {
  const queue = getQueue(ctx.guildId);
  if (!queue || !queue.current) {
    await ctx.reply({
      embeds: [buildEmbed('❌ Lỗi', 'Không có bài hát nào đang bị tạm dừng!', 0xff0000)],
    });
    return;
  }

  queue.resume();
  await ctx.reply({
    embeds: [buildEmbed('▶️ Tiếp tục phát', `Tiếp tục phát: **${queue.current.title}**`, 0x2ecc71)],
  });
}

// ─── STOP / LEAVE ───────────────────────────────────────────────────────

export async function handleStop(ctx: CommandContext): Promise<void> {
  const queue = getQueue(ctx.guildId);
  if (!queue) {
    await ctx.reply({
      embeds: [buildEmbed('❌ Lỗi', 'Bot hiện không có trong kênh thoại nào!', 0xff0000)],
    });
    return;
  }

  deleteQueue(ctx.guildId);
  await ctx.reply({
    embeds: [buildEmbed('⏹️ Đã dừng', 'Đã dừng nhạc, xóa hàng đợi và rời kênh thoại.', 0xe74c3c)],
  });
}

// ─── QUEUE ──────────────────────────────────────────────────────────────

export async function handleQueue(ctx: CommandContext): Promise<void> {
  const queue = getQueue(ctx.guildId);
  if (!queue || (!queue.current && queue.tracks.length === 0)) {
    await ctx.reply({
      embeds: [buildEmbed('📭 Hàng đợi trống', 'Không có bài hát nào trong hàng đợi.', 0x95a5a6)],
    });
    return;
  }

  let description = '';

  if (queue.current) {
    description += `🎵 **Đang phát:** [${queue.current.title}](${queue.current.url}) \`${queue.current.duration}\`\n\n`;
  }

  if (queue.tracks.length > 0) {
    description += '**📋 Hàng đợi:**\n';
    const displayLimit = Math.min(queue.tracks.length, 10);
    for (let i = 0; i < displayLimit; i++) {
      const t = queue.tracks[i];
      const sourceIcon = t.source === 'youtube' ? '🔴' : t.source === 'soundcloud' ? '🟠' : '🟢';
      description += `\`${i + 1}.\` ${sourceIcon} [${t.title}](${t.url}) \`${t.duration}\` • ${t.requester}\n`;
    }
    if (queue.tracks.length > 10) {
      description += `\n... và **${queue.tracks.length - 10}** bài hát khác.`;
    }
  }

  // Tổng thời lượng
  const totalSec =
    (queue.current?.durationSec || 0) +
    queue.tracks.reduce((sum, t) => sum + t.durationSec, 0);
  description += `\n\n⏱️ **Tổng thời lượng:** \`${formatDuration(totalSec)}\` • **${queue.tracks.length + (queue.current ? 1 : 0)}** bài hát`;

  await ctx.reply({
    embeds: [buildEmbed('🎶 Hàng đợi phát nhạc', description, 0x9b59b6)],
  });
}

// ─── NOW PLAYING ────────────────────────────────────────────────────────

export async function handleNowPlaying(ctx: CommandContext): Promise<void> {
  const queue = getQueue(ctx.guildId);
  if (!queue || !queue.current) {
    await ctx.reply({
      embeds: [buildEmbed('❌ Lỗi', 'Không có bài hát nào đang phát!', 0xff0000)],
    });
    return;
  }

  const track = queue.current;
  const sourceIcon = track.source === 'youtube' ? '🔴 YouTube' : track.source === 'soundcloud' ? '🟠 SoundCloud' : '🟢 Spotify';

  await ctx.reply({
    embeds: [
      buildEmbed(
        '🎵 Đang phát',
        `[**${track.title}**](${track.url})\n\n⏱️ Thời lượng: \`${track.duration}\`\n🎧 Nguồn: ${sourceIcon}\n👤 Yêu cầu bởi: **${track.requester}**\n📋 Còn **${queue.tracks.length}** bài trong hàng đợi`,
        0x3498db,
        track.thumbnail
      ),
    ],
  });
}

// ─── HELP ───────────────────────────────────────────────────────────────

export async function handleHelp(ctx: CommandContext, prefix: string): Promise<void> {
  const description = `
**🎵 Lệnh phát nhạc:**
\`/play <tên bài/link>\` hoặc \`${prefix}p <tên bài/link>\` — Phát nhạc từ link hoặc hỏi nền tảng khi tìm theo tên
Hỗ trợ link: YouTube, YouTube Playlist, SoundCloud, Spotify Track/Playlist/Album

**⏯️ Điều khiển:**
\`/skip\` hoặc \`${prefix}skip\` — Bỏ qua bài hiện tại
\`/pause\` hoặc \`${prefix}pause\` — Tạm dừng
\`/resume\` hoặc \`${prefix}resume\` — Tiếp tục phát
\`/stop\` hoặc \`${prefix}stop\` — Dừng nhạc và rời kênh

**📋 Thông tin:**
\`/list\` hoặc \`${prefix}l\` — Xem hàng đợi
\`/nowplaying\` hoặc \`${prefix}np\` — Bài đang phát
\`/help\` hoặc \`${prefix}help\` — Hiển thị hướng dẫn này
  `.trim();

  await ctx.reply({
    embeds: [buildEmbed('📖 Hướng dẫn sử dụng', description, 0x1abc9c)],
  });
}

// ─── Adapter: chuyển đổi Slash Command / Message thành CommandContext ───

export function fromInteraction(interaction: ChatInputCommandInteraction): CommandContext {
  return {
    guildId: interaction.guildId!,
    member: interaction.member as GuildMember,
    reply: async (content) => {
      if (typeof content === 'string') {
        await interaction.editReply({ content });
      } else {
        await interaction.editReply(content);
      }
    },
  };
}

export function fromButtonInteraction(interaction: ButtonInteraction): CommandContext {
  return {
    guildId: interaction.guildId!,
    member: interaction.member as GuildMember,
    reply: async (content) => {
      if (typeof content === 'string') {
        await interaction.editReply({ content });
      } else {
        await interaction.editReply(content);
      }
    },
  };
}

export function fromMessage(message: Message): CommandContext {
  return {
    guildId: message.guildId!,
    member: message.member as GuildMember,
    reply: async (content) => {
      if (typeof content === 'string') {
        await message.reply({ content });
      } else {
        await message.reply(content);
      }
    },
  };
}
