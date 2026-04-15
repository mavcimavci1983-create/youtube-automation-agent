require('dotenv').config();
const Groq = require('groq-sdk');
const { google } = require('googleapis');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { exec } = require('child_process');

// ─── CONFIG ───────────────────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const YOUTUBE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const YOUTUBE_REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN;

// ─── YARDIMCI FONKSİYONLAR ───────────────────────────────

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

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        reject(new Error(`HTTP ${response.statusCode}: ${url}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      try { fs.unlinkSync(dest); } catch(e) {}
      reject(err);
    });
  });
}

function runCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Komut hatası: ${error.message}\nStderr: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── 1. GROQ: İÇERİK ÜRET ───────────────────────────────
async function generateContent() {
  console.log('🤖 Groq ile içerik üretiliyor...');
  const groq = new Groq({ apiKey: GROQ_API_KEY });

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: 'Sen profesyonel Türkçe motivasyon videoları için içerik üretiyorsun. SADECE geçerli JSON döndür. Markdown, kod bloğu, açıklama yazma.'
      },
      {
        role: 'user',
        content: `Güçlü bir Türkçe motivasyon videosu için içerik üret.

SADECE bu JSON formatında döndür:
{
  "title": "YouTube başlığı 50-60 karakter",
  "description": "YouTube açıklaması 400-500 karakter",
  "tags": ["motivasyon", "basari", "hedef", "turkce", "gelisim"],
  "pexels_query": "nature mountain success landscape",
  "script_parts": [
    "Giris bolumu 3-4 cumle guclu baslangic",
    "Ana mesaj bolumu 4-5 cumle gercek hayat ornegi",
    "Derinlestirme bolumu 4-5 cumle duygusal bag",
    "Zirve bolumu 3-4 cumle en guclu mesaj",
    "Kapanis bolumu 3-4 cumle harekete gecir"
  ],
  "hashtags": "#motivasyon #basari #hedef #turkce #gelisim",
  "thumbnail_title": "3 KELIME BASLIK",
  "thumbnail_subtitle": "kisa alt baslik"
}`
      }
    ],
    temperature: 0.85,
    max_tokens: 2000,
  });

  const text = completion.choices[0].message.content.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON bulunamadi: ' + text.substring(0, 200));

  const content = JSON.parse(jsonMatch[0]);
  content.title = fixTurkish(content.title);
  content.description = fixTurkish(content.description);
  content.script_parts = content.script_parts.map(fixTurkish);
  content.thumbnail_title = fixTurkish(content.thumbnail_title);
  content.thumbnail_subtitle = fixTurkish(content.thumbnail_subtitle);

  console.log(`✅ İçerik: "${content.title}"`);
  return content;
}

// ─── 2. EDGE-TTS: SES ÜRET ──────────────────────────────
async function generateVoice(scriptParts) {
  console.log('🎙️ Edge-TTS ile ses üretiliyor...');

  const fullScript = scriptParts.join('\n\n');
  const scriptPath = '/tmp/script.txt';
  const audioPath = '/tmp/voice.mp3';

  fs.writeFileSync(scriptPath, fullScript, 'utf8');

  await runCommand(
    `edge-tts --voice tr-TR-EmelNeural --file "${scriptPath}" --write-media "${audioPath}" --rate="+5%"`
  );

  const stats = fs.statSync(audioPath);
  console.log(`✅ Ses: ${(stats.size / 1024).toFixed(0)} KB`);
  return audioPath;
}

// ─── 3. PEXELS: VİDEO İNDİR ─────────────────────────────
async function downloadPexelsVideos(query, count = 5) {
  console.log(`🎬 Pexels videoları indiriliyor: "${query}"`);

  const response = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=15&orientation=landscape`,
    { headers: { Authorization: PEXELS_API_KEY } }
  );

  if (!response.ok) throw new Error(`Pexels hatası: ${response.status}`);
  const data = await response.json();

  if (!data.videos || data.videos.length === 0) {
    throw new Error('Pexels video bulunamadı');
  }

  const videoPaths = [];
  const selected = data.videos.slice(0, count);

  for (let i = 0; i < selected.length; i++) {
    const video = selected[i];
    const videoFile = video.video_files
      .filter(f => f.width >= 1280)
      .sort((a, b) => a.width - b.width)[0]
      || video.video_files.sort((a, b) => b.width - a.width)[0];

    if (!videoFile) continue;

    const videoPath = `/tmp/pexels_${i}.mp4`;
    console.log(`  Video ${i + 1}/${selected.length} indiriliyor...`);
    await downloadFile(videoFile.link, videoPath);
    videoPaths.push(videoPath);
    await sleep(500);
  }

  console.log(`✅ ${videoPaths.length} video indirildi`);
  return videoPaths;
}

// ─── 4. THUMBNAIL ────────────────────────────────────────
async function createThumbnail(title, subtitle, videoPath) {
  console.log('🖼️ Thumbnail oluşturuluyor...');
  const thumbPath = '/tmp/thumbnail.jpg';

  const safeTitle = title.replace(/['"\\:]/g, ' ').trim();
  const safeSubtitle = subtitle.replace(/['"\\:]/g, ' ').trim();

  await new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: ['5%'],
        filename: 'thumb_raw.jpg',
        folder: '/tmp',
        size: '1280x720',
      })
      .on('end', resolve)
      .on('error', reject);
  });

  await runCommand(
    `ffmpeg -y -i /tmp/thumb_raw.jpg ` +
    `-vf "colorchannelmixer=rr=0.4:gg=0.4:bb=0.5,` +
    `drawtext=text='${safeTitle}':fontsize=85:fontcolor=white:x=(w-text_w)/2:y=(h/2)-70:shadowcolor=black:shadowx=3:shadowy=3,` +
    `drawtext=text='${safeSubtitle}':fontsize=42:fontcolor=yellow:x=(w-text_w)/2:y=(h/2)+60:shadowcolor=black:shadowx=2:shadowy=2" ` +
    `/tmp/thumbnail.jpg`
  );

  console.log('✅ Thumbnail hazır');
  return thumbPath;
}

// ─── 5. VİDEO MONTAJI ────────────────────────────────────
async function createFinalVideo(videoPaths, voicePath) {
  console.log('🎞️ Video montajı yapılıyor...');

  const audioDuration = await new Promise((resolve, reject) => {
    ffmpeg.ffprobe(voicePath, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata.format.duration);
    });
  });

  console.log(`Ses süresi: ${audioDuration.toFixed(1)}s`);
  const clipDuration = audioDuration / videoPaths.length;
  const trimmedPaths = [];

  for (let i = 0; i < videoPaths.length; i++) {
    const trimPath = `/tmp/trimmed_${i}.mp4`;
    await new Promise((resolve, reject) => {
      ffmpeg(videoPaths[i])
        .outputOptions([
          `-t ${clipDuration}`,
          '-vf scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black',
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
    console.log(`  Klip ${i + 1}/${videoPaths.length} hazır`);
  }

  const listPath = '/tmp/clips_list.txt';
  fs.writeFileSync(listPath, trimmedPaths.map(p => `file '${p}'`).join('\n'));

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

// ─── 6. YOUTUBE UPLOAD ───────────────────────────────────
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
  console.log(`✅ Video: https://youtube.com/watch?v=${videoId}`);

  try {
    await youtube.thumbnails.set({
      videoId,
      media: { body: fs.createReadStream(thumbnailPath) },
    });
    console.log('✅ Thumbnail yüklendi');
  } catch (e) {
    console.log('⚠️ Thumbnail hatası:', e.message);
  }

  return videoId;
}

// ─── ANA FONKSİYON ───────────────────────────────────────
async function main() {
  console.log('🚀 Kaliteli motivasyon videosu üretiliyor...\n');

  const tempFiles = [];

  try {
    const content = await generateContent();

    const voicePath = await generateVoice(content.script_parts);
    tempFiles.push(voicePath);

    const videoPaths = await downloadPexelsVideos(content.pexels_query, 5);
    tempFiles.push(...videoPaths);

    const finalVideoPath = await createFinalVideo(videoPaths, voicePath);
    tempFiles.push(finalVideoPath);

    const thumbnailPath = await createThumbnail(
      content.thumbnail_title,
      content.thumbnail_subtitle,
      videoPaths[0]
    );
    tempFiles.push(thumbnailPath);

    const videoId = await uploadToYouTube(content, finalVideoPath, thumbnailPath);

    tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });

    console.log(`\n🎉 BAŞARILI! Video ID: ${videoId}`);
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
