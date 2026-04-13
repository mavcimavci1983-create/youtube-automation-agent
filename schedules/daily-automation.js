require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');
const Jimp = require('jimp');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

// ─── CONFIG ───────────────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const YOUTUBE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const YOUTUBE_REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN;
const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;

// ─── GEMINI: İçerik Üret ─────────────────────────────────
async function generateContent() {
  console.log('🤖 Gemini ile içerik üretiliyor...');
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const prompt = `
Sen Türkçe motivasyon videoları için içerik üretiyorsun.
Bugün için VURUCU ve DİKKAT ÇEKİCİ bir motivasyon videosu içeriği oluştur.

Şu formatta JSON döndür (başka hiçbir şey yazma):
{
  "title": "YouTube başlığı (maksimum 60 karakter, emoji içerebilir)",
  "description": "YouTube açıklaması (300-500 karakter, hashtag içermeli)",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "script": "Video metni (60-90 saniyelik, güçlü ve motivasyonel, Türkçe)",
  "thumbnail_text": "Thumbnail'da yazacak kısa vurucu söz (maksimum 5 kelime)",
  "hashtags": "#motivasyon #türkçemotivasyon #başarı #hedef #günlükmotivasyon"
}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();

  // JSON parse
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Gemini JSON döndürmedi');

  const content = JSON.parse(jsonMatch[0]);
  console.log(`✅ İçerik üretildi: "${content.title}"`);
  return content;
}

// ─── THUMBNAIL OLUŞTUR ────────────────────────────────────
async function createThumbnail(thumbnailText) {
  console.log('🖼️ Thumbnail oluşturuluyor...');

  const width = 1280;
  const height = 720;

  const image = new Jimp(width, height, 0x1a1a2eff); // Koyu lacivert arka plan

  // Gradient efekti için katmanlar
  for (let y = 0; y < height; y++) {
    const alpha = Math.floor((y / height) * 100);
    for (let x = 0; x < width; x++) {
      const color = Jimp.rgbaToInt(20 + alpha, 20, 60 + alpha, 255);
      image.setPixelColor(color, x, y);
    }
  }

  // Yazı ekle
  const font = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);
  const fontSmall = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);

  // Ana motivasyon yazısı
  image.print(
    font,
    0, 260,
    { text: thumbnailText, alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER },
    width
  );

  // Alt yazı
  image.print(
    fontSmall,
    0, 380,
    { text: '🔥 Günlük Motivasyon', alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER },
    width
  );

  const thumbnailPath = '/tmp/thumbnail.jpg';
  await image.quality(90).writeAsync(thumbnailPath);
  console.log('✅ Thumbnail oluşturuldu');
  return thumbnailPath;
}

// ─── VİDEO OLUŞTUR ────────────────────────────────────────
async function createVideo(script, thumbnailPath) {
  console.log('🎬 Video oluşturuluyor...');

  const outputPath = '/tmp/video.mp4';

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(thumbnailPath)
      .inputOptions(['-loop 1'])
      .inputOptions(['-t 60']) // 60 saniye
      .videoCodec('libx264')
      .outputOptions([
        '-pix_fmt yuv420p',
        '-r 24',
        '-vf scale=1280:720',
        '-preset fast',
        '-crf 23',
      ])
      .noAudio()
      .output(outputPath)
      .on('end', () => {
        console.log('✅ Video oluşturuldu');
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('❌ Video hatası:', err.message);
        reject(err);
      })
      .run();
  });
}

// ─── YOUTUBE'A YÜKLE ──────────────────────────────────────
async function uploadToYouTube(content, videoPath, thumbnailPath) {
  console.log('📤 YouTube\'a yükleniyor...');

  const oauth2Client = new google.auth.OAuth2(
    YOUTUBE_CLIENT_ID,
    YOUTUBE_CLIENT_SECRET,
    'http://localhost:3000/callback'
  );

  oauth2Client.setCredentials({
    refresh_token: YOUTUBE_REFRESH_TOKEN,
  });

  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  // Video yükle
  const videoResponse = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: content.title,
        description: `${content.description}\n\n${content.hashtags}`,
        tags: content.tags,
        categoryId: '26', // How-to & Style
        defaultLanguage: 'tr',
        defaultAudioLanguage: 'tr',
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      body: fs.createReadStream(videoPath),
    },
  });

  const videoId = videoResponse.data.id;
  console.log(`✅ Video yüklendi: https://youtube.com/watch?v=${videoId}`);

  // Thumbnail yükle
  await youtube.thumbnails.set({
    videoId,
    media: {
      body: fs.createReadStream(thumbnailPath),
    },
  });

  console.log('✅ Thumbnail yüklendi');
  return videoId;
}

// ─── ANA FONKSİYON ────────────────────────────────────────
async function main() {
  console.log('🚀 Günlük motivasyon videosu oluşturuluyor...\n');

  try {
    // 1. İçerik üret
    const content = await generateContent();

    // 2. Thumbnail oluştur
    const thumbnailPath = await createThumbnail(content.thumbnail_text);

    // 3. Video oluştur
    const videoPath = await createVideo(content.script, thumbnailPath);

    // 4. YouTube'a yükle
    const videoId = await uploadToYouTube(content, videoPath, thumbnailPath);

    // 5. Temizlik
    fs.unlinkSync(videoPath);
    fs.unlinkSync(thumbnailPath);

    console.log(`\n🎉 BAŞARILI! Video ID: ${videoId}`);
    console.log(`🔗 https://youtube.com/watch?v=${videoId}`);
    process.exit(0);

  } catch (error) {
    console.error('\n❌ HATA:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
