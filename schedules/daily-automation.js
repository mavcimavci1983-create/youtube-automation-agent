require('dotenv').config();
const Groq = require('groq-sdk');
const { google } = require('googleapis');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ─── CONFIG ───────────────────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const YOUTUBE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const YOUTUBE_REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN;
const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;

// Türkçe karakter düzeltme
function fixTurkish(text) {
  if (!text) return '';
  return text
    .replace(/\u015e/g, 'Ş').replace(/\u015f/g, 'ş')
    .replace(/\u0130/g, 'İ').replace(/\u0131/g, 'ı')
    .replace(/\u00dc/g, 'Ü').replace(/\u00fc/g, 'ü')
    .replace(/\u00d6/g, 'Ö').replace(/\u00f6/g, 'ö')
    .replace(/\u00c7/g, 'Ç').replace(/\u00e7/g, 'ç')
    .replace(/\u011e/g, 'Ğ').replace(/\u011f/g, 'ğ');
}

// Dosya indir
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

// ─── 1. GROQ: İçerik Üret ────────────────────────────────
async function generateContent() {
  console.log('🤖 Groq ile içerik üretiliyor...');
  const groq = new Groq({ apiKey: GROQ_API_KEY });

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: 'Sen profesyonel Türkçe motivasyon videoları için içerik üretiyorsun. Sadece JSON döndür, markdown kullanma, kod bloğu kullanma.'
      },
      {
        role: 'user',
        content: `Bugün için güçlü, izleyiciyi derinden etkileyen bir motivasyon videosu içeriği oluştur.

JSON formatında döndür:
{
  "title": "YouTube başlığı (50-60 karakter, dikkat çekici, emoji yok)",
  "description": "YouTube açıklaması (400-500 karakter, hashtag olmadan)",
  "tags": ["motivasyon", "basari", "hedef", "turkce", "gelisim", "ilham", "guclu", "azim", "karakter", "zihin"],
  "pexels_query": "motivational landscape nature (İngilizce, Pexels için arama terimi)",
  "script_parts": [
    "Bölüm 1: Güçlü giriş - izleyiciyi hemen yakala (3-4 cümle)",
    "Bölüm 2: Ana mesaj - gerçek hayat örneği ver (4-5 cümle)", 
    "Bölüm 3: Derinleştir - duygusal bağ kur (4-5 cümle)",
    "Bölüm 4: Zirve - en güçlü mesaj (3-4 cümle)",
    "Bölüm 5: Kapanış - harekete geçir (3-4 cümle)"
  ],
  "hashtags": "#motivasyon #basari #hedef #turkce #gelisim #ilham #guclu #azim",
  "thumbnail_title": "Ana başlık (max 3 kelime, büyük harf, Türkçe)",
  "thumbnail_subtitle": "Alt başlık (max 5 kelime)"
}`
      }
    ],
    temperature: 0.85,
    max_tokens: 2000,
  });

  const text = completion.choices[0].message.content.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON parse hatası: ' + text.substring(0, 200));

  const content = JSON.parse(jsonMatch[0]);
  content.title = fixTurkish(content.title);
  content.description = fixTurkish(content.description);
  content.script_parts = content.script_parts.map(fixTurkish);
  content.thumbnail_title = fixTurkish(content.thumbnail_title);
  content.thumbnail_subtitle = fixTurkish(content.thumbnail_subtitle);

  console.log(`✅ İçerik: "${content.title}"`);
  return content;
}

// ─── 2. ELEVENLABS: Ses Üret ─────────────────────────────
async function generateVoice(scriptParts) {
  console.log('🎙️ ElevenLabs ile ses üretiliyor...');

  const fullScript = scriptParts.join('\n\n');
  console.log(`Script uzunluğu: ${fullScript.length} karakter`);

  // Rachel sesi - doğal ve güçlü
  const voiceId = '21m00Tcm4TlvDq8ikWAM';

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Accept': 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': ELEVENLABS_API_KEY,
    },
    body: JSON.stringify({
      text: fullScript,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.8,
        style: 0.6,
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ElevenLabs hatası: ${response.status} - ${err}`);
  }

  const audioBuffer = await response.arrayBuffer();
  const audioPath = '/tmp/voice.mp3';
  fs.writeFileSync(audioPath, Buffer.from(audioBuffer));
  console.log(`✅ Ses üretildi: ${(audioBuffer.byteLength / 1024).toFixed(0)} KB`);
  return audioPath;
}

// ─── 3. PEXELS: Video İndir ──────────────────────────────
async function downloadPexelsVideos(query, count = 5) {
  console.log(`🎬 Pexels'tan videolar indiriliyor: "${query}"`);

  const response = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=15&orientation=landscape`,
    { headers: { Authorization: PEXELS_API_KEY } }
  );

  if (!response.ok) throw new Error(`Pexels hatası: ${response.status}`);

  const data = await response.json();
  if (!data.videos || data.videos.length === 0) {
    throw new Error('Pexels video bulunamadı: ' + query);
  }

  const videoPaths = [];
  const selected = data.videos.slice(0, count);

  for (let i = 0; i < selected.length; i++) {
    const video = selected[i];
    // HD video dosyasını seç
    const videoFile = video.video_files
      .filter(f => f.quality === 'hd' || f.quality === 'sd')
      .sort((a, b) => (b.width || 0) - (a.width || 0))[0];

    if (!videoFile) continue;

    const videoPath = `/tmp/pexels_${i}.mp4`;
    console.log(`  İndiriliyor ${i + 1}/${selected.length}...`);
    await downloadFile(videoFile.link, videoPath);
    videoPaths.push(videoPath);
  }

  console.log(`✅ ${videoPaths.length} video indirildi`);
  return videoPaths;
}

// ─── 4. THUMBNAIL OLUŞTUR ────────────────────────────────
async function createThumbnail(title, subtitle, videoPath) {
  console.log('🖼️ Thumbnail oluşturuluyor...');
  const thumbPath = '/tmp/thumbnail.jpg';

  // Video'dan bir kare al, üstüne yazı ekle
  await new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: ['10%'],
        filename: 'thumb_raw.jpg',
        folder: '/tmp',
        size: '1280x720',
      })
      .on('end', resolve)
      .on('error', reject);
  });

  // ffmpeg ile başlık ekle
  const safeTitle = title.replace(/'/g, "\\'").replace(/:/g, '\\:');
  const safeSubtitle = subtitle.replace(/'/g, "\\'").replace(/:/g, '\\:');

  await new Promise((resolve, reject) => {
    ffmpeg('/tmp/thumb_raw.jpg')
      .videoFilter([
        // Karartma
        'colorchannelmixer=rr=0.4:gg=0.4:bb=0.4',
        // Ana başlık
        `drawtext=text='${safeTitle}':fontsize=90:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-60:shadowcolor=black:shadowx=3:shadowy=3:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf`,
        // Alt başlık
        `drawtext=text='${safeSubtitle}':fontsize=45:fontcolor=#FFD700:x=(w-text_w)/2:y=(h-text_h)/2+80:shadowcolor=black:shadowx=2:shadowy=2:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf`,
        // Alt şerit
        `drawtext=text='🔥 Günlük Motivasyon':fontsize=35:fontcolor=white:x=(w-text_w)/2:y=h-80:shadowcolor=black:shadowx=2:shadowy=2:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf`,
      ])
      .output(thumbPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });

  console.log('✅ Thumbnail oluşturuldu');
  return thumbPath;
}

// ─── 5. VİDEO MONTAJI ────────────────────────────────────
async function createFinalVideo(videoPaths, voicePath) {
  console.log('🎞️ Video montajı yapılıyor...');

  // Ses uzunluğunu öğren
  const audioDuration = await new Promise((resolve, reject) => {
    ffmpeg.ffprobe(voicePath, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata.format.duration);
    });
  });

  console.log(`Ses süresi: ${audioDuration.toFixed(1)} saniye`);

  // Her video klip için süre hesapla
  const clipDuration = audioDuration / videoPaths.length;
  const trimmedPaths = [];

  // Her klibi trim et
  for (let i = 0; i < videoPaths.length; i++) {
    const trimPath = `/tmp/trimmed_${i}.mp4`;
    await new Promise((resolve, reject) => {
      ffmpeg(videoPaths[i])
        .outputOptions([
          `-t ${clipDuration}`,
          '-vf scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2',
          '-r 30',
          '-c:v libx264',
          '-preset fast',
          '-crf 23',
          '-an',
        ])
        .output(trimPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
    trimmedPaths.push(trimPath);
    console.log(`  Klip ${i + 1}/${videoPaths.length} hazırlandı`);
  }

  // Klipleri birleştir için liste dosyası oluştur
  const listPath = '/tmp/clips_list.txt';
  const listContent = trimmedPaths.map(p => `file '${p}'`).join('\n');
  fs.writeFileSync(listPath, listContent);

  // Klipleri birleştir
  const mergedPath = '/tmp/merged.mp4';
  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(listPath)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c copy'])
      .output(mergedPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });

  // Ses ekle + müzik mixi
  const finalPath = '/tmp/final_video.mp4';
  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(mergedPath)
      .input(voicePath)
      .outputOptions([
        '-c:v copy',
        '-c:a aac',
        '-map 0:v:0',
        '-map 1:a:0',
        '-shortest',
        '-movflags +faststart',
      ])
      .output(finalPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });

  console.log('✅ Video montajı tamamlandı');
  return finalPath;
}

// ─── 6. YOUTUBE'A YÜKLE ──────────────────────────────────
async function uploadToYouTube(content, videoPath, thumbnailPath) {
  console.log('📤 YouTube\'a yükleniyor...');

  const oauth2Client = new google.auth.OAuth2(
    YOUTUBE_CLIENT_ID,
    YOUTUBE_CLIENT_SECRET,
    'http://localhost:3000/callback'
  );
  oauth2Client.setCredentials({ refresh_token: YOUTUBE_REFRESH_TOKEN });

  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  const videoResponse = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: content.title,
        description: `${content.description}\n\n${content.hashtags}`,
        tags: content.tags,
        categoryId: '26',
        defaultLanguage: 'tr',
        defaultAudioLanguage: 'tr',
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false,
      },
    },
    media: { body: fs.createReadStream(videoPath) },
  });

  const videoId = videoResponse.data.id;
  console.log(`✅ Video yüklendi: https://youtube.com/watch?v=${videoId}`);

  // Thumbnail yükle
  try {
    await youtube.thumbnails.set({
      videoId,
      media: { body: fs.createReadStream(thumbnailPath) },
    });
    console.log('✅ Thumbnail yüklendi');
  } catch (e) {
    console.log('⚠️ Thumbnail yüklenemedi:', e.message);
  }

  return videoId;
}

// ─── ANA FONKSİYON ────────────────────────────────────────
async function main() {
  console.log('🚀 Kaliteli motivasyon videosu üretiliyor...\n');

  const tempFiles = [];

  try {
    // 1. İçerik üret
    const content = await generateContent();

    // 2. Ses üret
    const voicePath = await generateVoice(content.script_parts);
    tempFiles.push(voicePath);

    // 3. Pexels videoları indir
    const videoPaths = await downloadPexelsVideos(content.pexels_query, 6);
    tempFiles.push(...videoPaths);

    // 4. Video montajı
    const finalVideoPath = await createFinalVideo(videoPaths, voicePath);
    tempFiles.push(finalVideoPath);

    // 5. Thumbnail
    const thumbnailPath = await createThumbnail(
      content.thumbnail_title,
      content.thumbnail_subtitle,
      videoPaths[0]
    );
    tempFiles.push(thumbnailPath);

    // 6. YouTube'a yükle
    const videoId = await uploadToYouTube(content, finalVideoPath, thumbnailPath);

    // Temizlik
    tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });

    console.log(`\n🎉 BAŞARILI!`);
    console.log(`🔗 https://youtube.com/watch?v=${videoId}`);
    process.exit(0);

  } catch (error) {
    tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
    console.error('\n❌ HATA:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
