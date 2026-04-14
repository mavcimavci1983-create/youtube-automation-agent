require('dotenv').config();
const Groq = require('groq-sdk');
const { google } = require('googleapis');
const Jimp = require('jimp');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const YOUTUBE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const YOUTUBE_REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN;
const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;

// ─── GROQ: İçerik Üret ───────────────────────────────────
async function generateContent() {
  console.log('🤖 Groq ile içerik üretiliyor...');

  const groq = new Groq({ apiKey: GROQ_API_KEY });

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: 'Sen Türkçe motivasyon videoları için içerik üretiyorsun. Sadece JSON döndür, başka hiçbir şey yazma, markdown kullanma.'
      },
      {
        role: 'user',
        content: `Bugün için VURUCU ve DİKKAT ÇEKİCİ bir motivasyon videosu içeriği oluştur.

Şu formatta JSON döndür:
{
  "title": "YouTube başlığı (maksimum 60 karakter, emoji içerebilir)",
  "description": "YouTube açıklaması (300-500 karakter)",
  "tags": ["motivasyon", "türkçe", "başarı", "hedef", "günlük"],
  "script": "Video metni (60-90 saniyelik, güçlü ve motivasyonel, Türkçe)",
  "thumbnail_text": "Thumbnail kısa vurucu söz (maksimum 4 kelime)",
  "hashtags": "#motivasyon #türkçemotivasyon #başarı #hedef #günlükmotivasyon"
}`
      }
    ],
    temperature: 0.9,
    max_tokens: 1500,
  });

  const text = completion.choices[0].message.content.trim();
  console.log('Groq yanıtı:', text.substring(0, 100));

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Groq JSON döndürmedi: ' + text);

  const content = JSON.parse(jsonMatch[0]);
  console.log(`✅ İçerik üretildi: "${content.title}"`);
  return content;
}

// ─── THUMBNAIL OLUŞTUR ────────────────────────────────────
async function createThumbnail(thumbnailText) {
  console.log('🖼️ Thumbnail oluşturuluyor...');

  const width = 1280;
  const height = 720;

  const image = new Jimp(width, height, 0x1a1a2eff);

  for (let y = 0; y < height; y++) {
    const ratio = y / height;
    const r = Math.floor(20 + ratio * 60);
    const g = Math.floor(10 + ratio * 20);
    const b = Math.floor(80 + ratio * 100);
    for (let x = 0; x < width; x++) {
      image.setPixelColor(Jimp.rgbaToInt(r, g, b, 255), x, y);
    }
  }

  const font64 = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);
  const font32 = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);

  image.print(
    font64, 0, 250,
    { text: thumbnailText.toUpperCase(), alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER },
    width
  );

  image.print(
    font32, 0, 380,
    { text: '🔥 Günlük Motivasyon', alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER },
    width
  );

  const thumbnailPath = '/tmp/thumbnail.jpg';
  await image.quality(90).writeAsync(thumbnailPath);
  console.log('✅ Thumbnail oluşturuldu');
  return thumbnailPath;
}

// ─── VİDEO OLUŞTUR ────────────────────────────────────────
async function createVideo(thumbnailPath) {
  console.log('🎬 Video oluşturuluyor...');
  const outputPath = '/tmp/video.mp4';

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(thumbnailPath)
      .inputOptions(['-loop 1', '-t 60'])
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
      .on('end', () => { console.log('✅ Video oluşturuldu'); resolve(outputPath); })
      .on('error', reject)
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

  await youtube.thumbnails.set({
    videoId,
    media: { body: fs.createReadStream(thumbnailPath) },
  });

  console.log('✅ Thumbnail yüklendi');
  return videoId;
}

// ─── ANA FONKSİYON ────────────────────────────────────────
async function main() {
  console.log('🚀 Günlük motivasyon videosu oluşturuluyor...\n');
  console.log('GROQ_API_KEY var mı:', !!GROQ_API_KEY);

  try {
    const content = await generateContent();
    const thumbnailPath = await createThumbnail(content.thumbnail_text);
    const videoPath = await createVideo(thumbnailPath);
    const videoId = await uploadToYouTube(content, videoPath, thumbnailPath);

    try { fs.unlinkSync(videoPath); fs.unlinkSync(thumbnailPath); } catch(e) {}

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
