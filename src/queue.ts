import {
  AudioPlayer,
  AudioPlayerStatus,
  VoiceConnection,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  demuxProbe,
  entersState,
  joinVoiceChannel,
  StreamType,
} from '@discordjs/voice';
import play from 'play-dl';
import youtubedl from 'youtube-dl-exec';
import { Track, cleanYoutubeUrl, resolveSpotifyTrack } from './parser';
import { GuildMember, TextChannel, EmbedBuilder } from 'discord.js';
import { Readable } from 'stream';
import { spawn } from 'child_process';

const { constants: youtubeDlConstants } = require('youtube-dl-exec');

// ─── GuildQueue: quản lý hàng đợi của 1 server ─────────────────────────

export class GuildQueue {
  public tracks: Track[] = [];
  public current: Track | null = null;
  public connection: VoiceConnection | null = null;
  public player: AudioPlayer;
  public textChannel: TextChannel | null = null;
  public isPlaying: boolean = false;

  constructor() {
    this.player = createAudioPlayer();

    // Khi bài hát phát xong → chuyển sang bài tiếp theo
    this.player.on(AudioPlayerStatus.Idle, () => {
      this.processQueue();
    });

    this.player.on('stateChange', (oldState, newState) => {
      console.log(`[AudioPlayer] ${oldState.status} -> ${newState.status}`);
    });

    // Khi gặp lỗi
    this.player.on('error', (error) => {
      console.error('[AudioPlayer Error]', error.message);
      this.sendEmbed(
        '❌ Lỗi phát nhạc',
        `Đã xảy ra lỗi: ${error.message}`,
        0xff0000
      );
      this.processQueue();
    });
  }

  /**
   * Thêm danh sách track vào hàng đợi
   */
  public enqueue(tracks: Track[]): void {
    this.tracks.push(...tracks);
  }

  /**
   * Kết nối vào voice channel của người dùng
   */
  public join(member: GuildMember): VoiceConnection {
    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
      throw new Error('Bạn cần vào một kênh thoại trước!');
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator as any,
    });

    connection.subscribe(this.player);

    // Khi bị ngắt kết nối → dọn dẹp
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        // Chờ xem có tự kết nối lại không (di chuyển kênh)
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        // Không kết nối lại được → dọn dẹp
        this.destroy();
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      this.cleanup();
    });

    this.connection = connection;
    return connection;
  }

  /**
   * Xử lý hàng đợi: lấy bài tiếp theo ra và phát
   */
  public async processQueue(): Promise<void> {
    if (this.tracks.length === 0) {
      this.current = null;
      this.isPlaying = false;

      this.sendEmbed(
        '📭 Hết nhạc',
        'Hàng đợi đã hết. Sử dụng `/play` hoặc `!play` để thêm bài mới.',
        0x95a5a6
      );

      // Tự ngắt kết nối sau 2 phút nếu không có bài mới
      setTimeout(() => {
        if (this.tracks.length === 0 && !this.isPlaying) {
          this.destroy();
        }
      }, 120_000);

      return;
    }

    const track = this.tracks.shift()!;
    this.current = track;
    this.isPlaying = true;

    console.log('[DEBUG] Playing track:', JSON.stringify(track, null, 2));

    try {
      let streamUrl = track.url;
      let playbackSource = track.source;

      // Nếu là bài từ Spotify → resolve sang YouTube trước
      if (track.source === 'spotify') {
        const resolved = await resolveSpotifyTrack(track.title);
        if (!resolved) {
          this.sendEmbed(
            '⚠️ Bỏ qua',
            `Không tìm được bài **${track.title}** trên YouTube. Chuyển bài tiếp theo...`,
            0xf39c12
          );
          this.processQueue();
          return;
        }
        streamUrl = resolved.url;
        playbackSource = 'youtube';
      }

      const resource = await this.createTrackResource(streamUrl, playbackSource);

      this.player.play(resource);

      this.sendEmbed(
        '🎵 Đang phát',
        `[**${track.title}**](${track.url})\n⏱️ \`${track.duration}\` • Yêu cầu bởi **${track.requester}**`,
        0x3498db,
        track.thumbnail
      );
    } catch (error: any) {
      console.error('[Queue] Lỗi khi phát bài:', error);
      this.sendEmbed(
        '❌ Lỗi phát nhạc',
        `Không thể phát bài **${track.title}**: ${error.message}`,
        0xff0000
      );
      this.processQueue();
    }
  }

  private async createTrackResource(streamUrl: string, source: Track['source']) {
    const playableUrl = source === 'youtube' ? cleanYoutubeUrl(streamUrl) : streamUrl;

    if (source === 'youtube') {
      const subprocess = spawn(youtubeDlConstants.YOUTUBE_DL_PATH, [
        playableUrl,
        '--format',
        'bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio',
        '--output',
        '-',
        '--quiet',
        '--no-warnings',
        '--no-playlist',
      ], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const stderrChunks: string[] = [];

      subprocess.stderr?.on('data', (chunk: Buffer) => {
        const message = chunk.toString().trim();
        if (!message) return;
        stderrChunks.push(message);
        if (!message.includes('Broken pipe')) {
          console.warn('[yt-dlp]', message);
        }
      });

      subprocess.on('error', (error) => {
        console.error('[yt-dlp] Không thể khởi chạy:', error.message);
      });

      subprocess.on('close', (code, signal) => {
        const stderr = stderrChunks.join('\n');
        if (code && !stderr.includes('Broken pipe')) {
          console.error(`[yt-dlp] Thoát với code ${code}${signal ? `, signal ${signal}` : ''}`);
        }
      });

      return createAudioResource(subprocess.stdout, {
        inputType: StreamType.Arbitrary,
      });
    }

    if (source === 'soundcloud') {
      const audioUrl = await this.getDirectAudioUrl(playableUrl, source);
      const response = await fetch(audioUrl, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('mpegurl') || contentType.includes('m3u8')) {
        throw new Error('yt-dlp trả về HLS playlist thay vì audio stream trực tiếp.');
      }

      if (!response.ok || !response.body) {
        throw new Error(`yt-dlp lấy được URL nhưng không mở được audio stream (${response.status})`);
      }

      const stream = Readable.fromWeb(response.body as any);
      const probe = await demuxProbe(stream);
      return createAudioResource(probe.stream, {
        inputType: probe.type,
      });
    }

    const streamData = await play.stream(playableUrl);
    return createAudioResource(streamData.stream, {
      inputType: streamData.type,
    });
  }

  private async getDirectAudioUrl(url: string, source: Track['source']): Promise<string> {
    const result = await youtubedl(url, {
        format: source === 'soundcloud'
          ? 'bestaudio[protocol=http]/bestaudio[protocol=https]/http_mp3_1_0/bestaudio'
          : 'bestaudio[acodec=opus][ext=webm]/bestaudio',
        getUrl: true,
        quiet: true,
        noWarnings: true,
        noPlaylist: true,
      });

    const audioUrl = String(result)
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(line => line.startsWith('http'));

    if (!audioUrl) {
      throw new Error('yt-dlp không trả về audio URL hợp lệ.');
    }

    return audioUrl;
  }

  /**
   * Bỏ qua bài hiện tại
   */
  public skip(): void {
    this.player.stop();
    // Sự kiện Idle sẽ tự kích hoạt processQueue
  }

  /**
   * Tạm dừng phát nhạc
   */
  public pause(): boolean {
    return this.player.pause();
  }

  /**
   * Tiếp tục phát nhạc
   */
  public resume(): boolean {
    return this.player.unpause();
  }

  /**
   * Dừng nhạc và xóa toàn bộ hàng đợi
   */
  public stop(): void {
    this.tracks = [];
    this.current = null;
    this.isPlaying = false;
    this.player.stop(true);
  }

  /**
   * Ngắt kết nối và dọn dẹp
   */
  public destroy(): void {
    this.stop();
    if (this.connection) {
      this.connection.destroy();
      this.connection = null;
    }
  }

  /**
   * Dọn dẹp bộ nhớ (khi connection đã bị destroy từ bên ngoài)
   */
  private cleanup(): void {
    this.tracks = [];
    this.current = null;
    this.isPlaying = false;
    this.connection = null;
  }

  /**
   * Gửi thông báo embed đẹp mắt tới kênh text
   */
  private sendEmbed(
    title: string,
    description: string,
    color: number,
    thumbnail?: string
  ): void {
    if (!this.textChannel) return;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(color)
      .setTimestamp();

    if (thumbnail) {
      embed.setThumbnail(thumbnail);
    }

    this.textChannel.send({ embeds: [embed] }).catch(console.error);
  }
}

// ─── QueueManager: quản lý hàng đợi của tất cả server ──────────────────

const queues = new Map<string, GuildQueue>();

export function getQueue(guildId: string): GuildQueue | undefined {
  return queues.get(guildId);
}

export function getOrCreateQueue(guildId: string): GuildQueue {
  let queue = queues.get(guildId);
  if (!queue) {
    queue = new GuildQueue();
    queues.set(guildId, queue);
  }
  return queue;
}

export function deleteQueue(guildId: string): void {
  const queue = queues.get(guildId);
  if (queue) {
    queue.destroy();
    queues.delete(guildId);
  }
}
