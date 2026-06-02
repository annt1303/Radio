import play from 'play-dl';
import fetch from 'isomorphic-unfetch';
import youtubedl from 'youtube-dl-exec';

const customFetch = (url: string, options: any = {}) => {
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
};
const spotify = require('spotify-url-info')(customFetch);

export interface Track {
  title: string;
  url: string; // YouTube or SoundCloud streamable URL. Với Spotify, ban đầu là link Spotify, sẽ được phân giải (resolve) sang YouTube khi phát.
  thumbnail: string;
  duration: string; // Ví dụ: "03:45"
  durationSec: number; // Tính bằng giây
  requester: string; // Tên người yêu cầu bài hát
  source: 'youtube' | 'soundcloud' | 'spotify';
}

/**
 * Định dạng số giây thành chuỗi thời lượng MM:SS hoặc HH:MM:SS
 */
export function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const pad = (n: number) => n.toString().padStart(2, '0');
  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

export function cleanYoutubeUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname.includes('youtube.com')) {
      const videoId = urlObj.searchParams.get('v');
      if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }
    } else if (urlObj.hostname.includes('youtu.be')) {
      const videoId = urlObj.pathname.split('/').filter(Boolean)[0];
      if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }
    }
  } catch (e) {
    // Bỏ qua lỗi parse URL
  }
  return url;
}

function youtubeUrl(url?: string, id?: string): string {
  if (url) return cleanYoutubeUrl(url);
  return id ? `https://www.youtube.com/watch?v=${id}` : '';
}

function getYoutubeVideoUrl(url: string): string | null {
  const cleanUrl = cleanYoutubeUrl(url);
  return cleanUrl.includes('youtube.com/watch?v=') ? cleanUrl : null;
}

function isSoundCloudUrl(url: string): boolean {
  try {
    return new URL(url).hostname.includes('soundcloud.com');
  } catch {
    return false;
  }
}

export function isSupportedLink(query: string): boolean {
  try {
    const hostname = new URL(query.trim()).hostname;
    return (
      hostname.includes('youtube.com') ||
      hostname.includes('youtu.be') ||
      hostname.includes('soundcloud.com') ||
      hostname.includes('spotify.com')
    );
  } catch {
    return query.includes('spotify.com');
  }
}

async function getSoundCloudTrack(url: string, requester: string): Promise<Track[]> {
  const info: any = await youtubedl(url, {
    dumpSingleJson: true,
    noPlaylist: true,
    quiet: true,
    noWarnings: true,
  });

  const durationSec = Math.floor(Number(info.duration) || 0);
  return [{
    title: info.title || info.track || 'Bài hát SoundCloud',
    url: info.webpage_url || url,
    thumbnail: info.thumbnail || info.thumbnails?.at?.(-1)?.url || '',
    duration: formatDuration(durationSec),
    durationSec,
    requester,
    source: 'soundcloud'
  }];
}

/**
 * Phân tích chuỗi tìm kiếm hoặc URL để trả về danh sách Track
 */
export async function parseQuery(
  query: string,
  requester: string,
  searchPlatform: 'youtube' | 'soundcloud' = 'youtube'
): Promise<Track[]> {
  const trimmed = query.trim();

  // 1. Kiểm tra nếu là liên kết Spotify
  if (trimmed.includes('spotify.com')) {
    try {
      const tracksData = await spotify.getTracks(trimmed);
      if (!tracksData || tracksData.length === 0) {
        throw new Error('Không tìm thấy bài hát nào từ link Spotify này.');
      }

      return tracksData.map((track: any) => {
        const artistName = track.artist || 'Không rõ nghệ sĩ';
        const title = `${track.name} - ${artistName}`;
        const durationSec = track.duration ? Math.floor(track.duration / 1000) : 0;
        
        let trackUrl = trimmed;
        if (track.uri && track.uri.startsWith('spotify:track:')) {
          const id = track.uri.split(':')[2];
          trackUrl = `https://open.spotify.com/track/${id}`;
        }

        return {
          title,
          url: trackUrl,
          thumbnail: 'https://images.unsplash.com/photo-1614680376593-902f74fa0d41', // fallback ảnh mặc định
          duration: formatDuration(durationSec),
          durationSec,
          requester,
          source: 'spotify'
        };
      });
    } catch (error: any) {
      console.error('Lỗi khi phân tích Spotify URL:', error);
      throw new Error(`Không thể phân tích liên kết Spotify này: ${error.message}`);
    }
  }

  // 2. Kiểm tra nếu là liên kết SoundCloud
  if (isSoundCloudUrl(trimmed)) {
    try {
      return await getSoundCloudTrack(trimmed, requester);
    } catch (error: any) {
      console.error('Lỗi khi lấy nhạc SoundCloud bằng yt-dlp:', error);
      throw new Error(`Không thể tải bài hát SoundCloud này: ${error.message}`);
    }
  }

  // 3. Kiểm tra nếu là liên kết YouTube
  const youtubeVideoUrl = getYoutubeVideoUrl(trimmed);
  if (youtubeVideoUrl) {
    try {
      const videoInfo = await play.video_basic_info(youtubeVideoUrl);
      const details = videoInfo.video_details;
      return [{
        title: details.title || 'Bài hát YouTube',
        url: youtubeUrl(details.url, details.id) || youtubeVideoUrl,
        thumbnail: details.thumbnails[0]?.url || '',
        duration: formatDuration(details.durationInSec),
        durationSec: details.durationInSec,
        requester,
        source: 'youtube'
      }];
    } catch (error: any) {
      console.error('Lỗi khi lấy thông tin video YouTube:', error);
      throw new Error('Không thể lấy thông tin từ link YouTube này.');
    }
  }

  const ytValidate = await play.validate(trimmed);
  if (ytValidate === 'yt_video') {
    try {
      const cleanUrl = cleanYoutubeUrl(trimmed);
      const videoInfo = await play.video_basic_info(cleanUrl);
      const details = videoInfo.video_details;
      return [{
        title: details.title || 'Bài hát YouTube',
        url: youtubeUrl(details.url, details.id) || cleanUrl,
        thumbnail: details.thumbnails[0]?.url || '',
        duration: formatDuration(details.durationInSec),
        durationSec: details.durationInSec,
        requester,
        source: 'youtube'
      }];
    } catch (error: any) {
      console.error('Lỗi khi lấy thông tin video YouTube:', error);
      throw new Error('Không thể lấy thông tin từ link YouTube này.');
    }
  } else if (ytValidate === 'yt_playlist') {
    try {
      const playlistInfo = await play.playlist_info(trimmed, { incomplete: true });
      const videos = await playlistInfo.all_videos();
      return videos.map(video => ({
        title: video.title || 'Bài hát YouTube',
        url: youtubeUrl(video.url, video.id),
        thumbnail: video.thumbnails[0]?.url || '',
        duration: formatDuration(video.durationInSec),
        durationSec: video.durationInSec,
        requester,
        source: 'youtube' as const
      })).filter(track => track.url);
    } catch (error: any) {
      console.warn('Lỗi khi tải danh sách phát YouTube, thử tải dưới dạng video đơn lẻ:', error.message);
      
      // Fallback: Nếu URL chứa video ID, thử tải video đơn lẻ
      if (trimmed.includes('watch?v=') || trimmed.includes('youtu.be/')) {
        try {
          const cleanUrl = cleanYoutubeUrl(trimmed);
          const videoInfo = await play.video_basic_info(cleanUrl);
          const details = videoInfo.video_details;
          return [{
            title: details.title || 'Bài hát YouTube',
            url: youtubeUrl(details.url, details.id) || cleanUrl,
            thumbnail: details.thumbnails[0]?.url || '',
            duration: formatDuration(details.durationInSec),
            durationSec: details.durationInSec,
            requester,
            source: 'youtube'
          }];
        } catch (videoError: any) {
          console.error('Lỗi khi tải video đơn lẻ sau fallback:', videoError);
        }
      }
      throw new Error('Không thể tải danh sách phát YouTube này. Có thể đây là danh sách phát động (Mix) hoặc danh sách riêng tư.');
    }
  }

  // 4. Kiểm tra nếu là liên kết SoundCloud bằng play-dl (fallback cho dạng URL lạ)
  const scValidate = await play.validate(trimmed);
  if (scValidate === 'so_track') {
    try {
      const scData = await play.soundcloud(trimmed);
      if (scData.type === 'track') {
        const trackInfo = scData as any;
        return [{
          title: trackInfo.name,
          url: trackInfo.url || trimmed,
          thumbnail: trackInfo.user?.thumbnail || '',
          duration: formatDuration(trackInfo.durationInSec || 0),
          durationSec: trackInfo.durationInSec || 0,
          requester,
          source: 'soundcloud'
        }];
      }
    } catch (error: any) {
      console.error('Lỗi khi lấy nhạc SoundCloud:', error);
      throw new Error('Không thể tải bài hát SoundCloud này.');
    }
  } else if (scValidate === 'so_playlist') {
    try {
      const scData = await play.soundcloud(trimmed);
      if (scData.type === 'playlist') {
        const playlistInfo = scData as any;
        const tracks = await playlistInfo.all_tracks();
        return tracks.map((track: any) => ({
          title: track.name,
          url: track.url || trimmed,
          thumbnail: track.user?.thumbnail || '',
          duration: formatDuration(track.durationInSec || 0),
          durationSec: track.durationInSec || 0,
          requester,
          source: 'soundcloud'
        }));
      }
    } catch (error: any) {
      console.error('Lỗi khi lấy playlist SoundCloud:', error);
      throw new Error('Không thể tải danh sách nhạc SoundCloud này.');
    }
  }

  // 5. Nếu không phải liên kết, thực hiện tìm kiếm theo từ khóa
  if (searchPlatform === 'soundcloud') {
    try {
      const results = await play.search(trimmed, {
        limit: 1,
        source: { soundcloud: 'tracks' }
      });
      if (results.length === 0) {
        throw new Error(`Không tìm thấy kết quả nào cho "${trimmed}" trên SoundCloud.`);
      }
      const track = results[0];
      return [{
        title: track.name || 'Bài hát SoundCloud',
        url: track.url,
        thumbnail: track.thumbnail || '',
        duration: formatDuration(track.durationInSec || 0),
        durationSec: track.durationInSec || 0,
        requester,
        source: 'soundcloud'
      }];
    } catch (error: any) {
      console.error('Lỗi tìm kiếm trên SoundCloud:', error);
      throw new Error(`Lỗi khi tìm kiếm trên SoundCloud: ${error.message}`);
    }
  } else {
    // Mặc định tìm kiếm trên YouTube
    try {
      const results = await play.search(trimmed, {
        limit: 1
      });
      if (results.length === 0) {
        throw new Error(`Không tìm thấy kết quả nào cho "${trimmed}" trên YouTube.`);
      }
      const video = results[0];
      return [{
        title: video.title || 'Bài hát YouTube',
        url: youtubeUrl(video.url, video.id),
        thumbnail: video.thumbnails[0]?.url || '',
        duration: formatDuration(video.durationInSec),
        durationSec: video.durationInSec,
        requester,
        source: 'youtube'
      }];
    } catch (error: any) {
      console.error('Lỗi tìm kiếm trên YouTube:', error);
      throw new Error(`Lỗi khi tìm kiếm trên YouTube: ${error.message}`);
    }
  }
}

/**
 * Tìm kiếm và phân giải tiêu đề bài hát Spotify sang link YouTube để phát nhạc
 */
export async function resolveSpotifyTrack(trackTitle: string): Promise<{ url: string; durationSec: number } | null> {
  try {
    const searchResults = await play.search(trackTitle, { limit: 1 });
    if (searchResults.length > 0) {
      return {
        url: youtubeUrl(searchResults[0].url, searchResults[0].id),
        durationSec: searchResults[0].durationInSec
      };
    }
  } catch (error) {
    console.error(`Lỗi khi resolve bài hát Spotify "${trackTitle}":`, error);
  }
  return null;
}
