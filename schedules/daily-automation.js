require('dotenv').config();
const Groq = require('groq-sdk');
const { google } = require('googleapis');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { exec } = require('child_process');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const YOUTUBE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const YOUTUBE_REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN;

// ─── YARDIMCILAR ─────────────────────────────────────────

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
        try { fs.unlinkSync(dest); } catch(e) {}
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        reject(new Error(`HTTP ${response.statusCode}`));
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
    exec(command, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${error.message}\n${stderr}`));
      else resolve(stdout);
    });
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── 1. GROQ: İÇERİK ─────────────────────────────────────
async function generateContent() {
  console.log('🤖 Groq ile içerik üretiliyor...');
  const groq = new Groq({ apiKey: GROQ_API_KEY });

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: 'Sen YouTube Shorts için Türkçe motivasyon içeriği üretiyorsun. SADECE geçerli JSON döndür. Asla markdown veya kod bloğu kullanma.'
      },
      {
        role: 'user',
        content: `YouTube Shorts için 45-55 saniyelik güçlü Türkçe motivasyon videosu içeriği üret.

SADECE bu JSON formatında döndür:
{
  "title": "Başlık 40-50 karakter #Shorts",
  "description": "Açıklama 200-300 karakter",
  "tags": ["shorts", "motivasyon", "basari", "turkce", "gunluk"],
  "pexels_query": "mountain peak success nature",
  "script": "Tam video metni - 45-55 saniyelik, güçlü ve akıcı, Türkçe. Kısa cümleler kullan. Noktalama işaretleri ekle.",
  "hashtags": "#Shorts #motivasyon #basari #turkce #gunluk",
  "thumbnail_title": "IKI UC KELIME",
  "thumbnail_subtitle": "kisa etkileyici cumle"
}`
      }
    ],
    temperature: 0.85,
    max_tokens: 1500,
  });

  const text = completion.choices[0].message.content.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON bulunamadı: ' + text.substring(0, 200));

  const content = JSON.parse(jsonMatch[0]);
  content.title = fixTurkish(content.title);
  content.description = fixTurkish(content.description);
  content.script = fixTurkish(content.script);
  content.thumbnail_title = fixTurkish(content.thumbnail_title);
  content.thumbnail_subtitle = fixTurkish(content.thumbnail_subtitle);

  console.log(`✅ İçerik: "${content.title}"`);
  return content;
}

// ─── 2. EDGE-TTS: SES ────────────────────────────────────
async function generateVoice(script) {
  console.log('🎙️ Edge-TTS (AhmetNeural) ile ses üretiliyor...');

  const scriptPath = '/tmp/script.txt';
  const audioPath = '/tmp/voice.mp3';

  fs.writeFileSync(scriptPath, script, 'utf8');

  await runCommand(
    `edge-tts --voice tr-TR-AhmetNeural --file "${scriptPath}" --write-media "${audioPath}" --rate="+10%" --pitch="+5Hz"`
  );

  // Ses süresini kontrol et
  const duration = await new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, meta) => {
      if (err) reject(err);
      else resolve(meta.format.duration);
    });
  });

  console.log(`✅ Ses: ${duration.toFixed(1)}s`);
  return { audioPath, duration };
}

// ─── 3. ALTYAZI OLUŞTUR (SRT) ────────────────────────────
async function generateSubtitles(script, duration, audioPath) {
  console.log('📝 Altyazı oluşturuluyor...');

  // VTT dosyası oluştur (edge-tts'in kendi altyazısı)
  const scriptPath = '/tmp/script.txt';
  const vttPath = '/tmp/subtitles.vtt';
  const srtPath = '/tmp/subtitles.srt';

  // Edge-TTS ile word-timing altyazı al
  try {
    await runCommand(
      `edge-tts --voice tr-TR-AhmetNeural --file "${scriptPath}" --write-media /tmp/voice_sub.mp3 --write-subtitles "${vttPath}" --rate="+10%" --pitch="+5Hz"`
    );

    // VTT → SRT dönüştür
    const vttContent = fs.readFileSync(vttPath, 'utf8');
    const srtContent = convertVttToSrt(vttContent);
    fs.writeFileSync(srtPath, srtContent, 'utf8');
    console.log('✅ Altyazı (word-timing) oluşturuldu');

  } catch (e) {
    console.log('⚠️ VTT alınamadı, manuel altyazı oluşturuluyor...');
    // Fallback: cümleleri eşit böl
    const sentences = script.split(/[.!?]+/).filter(s => s.trim().length > 3);
    const timePerSentence = duration / sentences.length;
    let srtContent = '';

    sentences.forEach((sentence, i) => {
      const start = i * timePerSentence;
      const end = Math.min((i + 1) * timePerSentence, duration - 0.1);
      srtContent += `${i + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${sentence.trim()}\n\n`;
    });

    fs.writeFileSync(srtPath, srtContent, 'utf8');
  }

  return srtPath;
}

function convertVttToSrt(vttContent) {
  const lines = vttContent.split('\n');
  let srtContent = '';
  let counter = 1;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.includes('-->')) {
      const timeLine = line.replace(/\./g, ',');
      const text = lines[i + 1] ? lines[i + 1].trim() : '';
      if (text) {
        srtContent += `${counter}\n${timeLine}\n${text}\n\n`;
        counter++;
      }
    }
    i++;
  }
  return srtContent;
}

function formatSrtTime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
  return `${h}:${m}:${s},${ms}`;
}

// ─── 4. PEXELS VİDEO ─────────────────────────────────────
async function downloadPexelsVideos(query, count = 4) {
  console.log(`🎬 Pexels videoları: "${query}"`);

  const response = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=15&orientation=portrait`,
    { headers: { Authorization: PEXELS_API_KEY } }
  );

  if (!response.ok) throw new Error(`Pexels: ${response.status}`);
  const data = await response.json();

  // Portrait bulamazsa landscape dene
  let videos = data.videos || [];
  if (videos.length === 0) {
    const r2 = await fetch(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=15`,
      { headers: { Authorization: PEXELS_API_KEY } }
    );
    const d2 = await r2.json();
    videos = d2.videos || [];
  }

  if (videos.length === 0) throw new Error('Pexels video bulunamadı');

  const videoPaths = [];
  for (let i = 0; i < Math.min(count, videos.length); i++) {
    const video = videos[i];
    const videoFile = video.video_files
      .filter(f => f.width && f.height)
      .sort((a, b) => b.height - a.height)[0];

    if (!videoFile) continue;

    const videoPath = `/tmp/pexels_${i}.mp4`;
    console.log(`  Video ${i + 1}/${Math.min(count, videos.length)}...`);
    await downloadFile(videoFile.link, videoPath);
    videoPaths.push(videoPath);
    await sleep(300);
  }

  console.log(`✅ ${videoPaths.length} video indirildi`);
  return videoPaths;
}

// ─── 5. THUMBNAIL ────────────────────────────────────────
async function createThumbnail(title, subtitle, videoPath) {
  console.log('🖼️ Thumbnail (9:16) oluşturuluyor...');
  const thumbPath = '/tmp/thumbnail.jpg';

  // Video'dan kare al - dikey format
  await new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: ['10%'],
        filename: 'thumb_raw.jpg',
        folder: '/tmp',
        size: '1080x1920',
      })
      .on('end', resolve)
      .on('error', () => {
        // Fallback: scale ile
        ffmpeg(videoPath)
          .outputOptions(['-vframes 1', '-vf scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920'])
          .output('/tmp/thumb_raw.jpg')
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
  });

  const safeTitle = title.replace(/['"\\]/g, '').trim();
  const safeSubtitle = subtitle.replace(/['"\\]/g, '').trim();

  await runCommand(
    `ffmpeg -y -i /tmp/thumb_raw.jpg ` +
    `-vf "colorchannelmixer=rr=0.35:gg=0.35:bb=0.45,` +
    `drawtext=text='${safeTitle}':fontsize=100:fontcolor=white:x=(w-text_w)/2:y=(h/2)-120:shadowcolor=black:shadowx=4:shadowy=4,` +
    `drawtext=text='${safeSubtitle}':fontsize=50:fontcolor=yellow:x=(w-text_w)/2:y=(h/2)+60:shadowcolor=black:shadowx=2:shadowy=2,` +
    `drawtext=text='#Shorts':fontsize=45:fontcolor=white:x=(w-text_w)/2:y=h-120:shadowcolor=black:shadowx=2:shadowy=2" ` +
    `${thumbPath}`
  );

  console.log('✅ Thumbnail hazır');
  return thumbPath;
}

// ─── 6. SHORTS VİDEO MONTAJI ─────────────────────────────
async function createShortsVideo(videoPaths, audioPath, duration, srtPath) {
  console.log('🎞️ Shorts video montajı (1080x1920)...');

  const clipDuration = duration / videoPaths.length;
  const trimmedPaths = [];

  // Her klibi dikey formata çevir ve trim et
  for (let i = 0; i < videoPaths.length; i++) {
    const trimPath = `/tmp/trimmed_${i}.mp4`;
    await new Promise((resolve, reject) => {
      ffmpeg(videoPaths[i])
        .outputOptions([
          `-t ${clipDuration + 0.5}`,
          // Dikey 9:16 format
          '-vf scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1',
          '-r 30',
          '-c:v libx264',
          '-preset fast',
          '-crf 22',
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

  // Klipleri birleştir
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

  // Ses + altyazı ekle
  const finalPath = '/tmp/final_video.mp4';

  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(mergedPath)
      .input(audioPath)
      .outputOptions([
        '-map 0:v:0',
        '-map 1:a:0',
        '-c:v libx264',
        '-preset fast',
        '-crf 22',
        '-c:a aac',
        '-b:a 128k',
        '-shortest',
        '-movflags +faststart',
      ])
      .videoFilter(`subtitles=/tmp/subtitles.srt:force_style='FontSize=18,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,Shadow=1,Alignment=2,MarginV=80'`)
      .output(finalPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });

  const stats = fs.statSync(finalPath);
  console.log(`✅ Video hazır: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
  return finalPath;
}

// ─── 7. YOUTUBE UPLOAD ───────────────────────────────────
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
        description: `${content.description}\n\n${content.hashtags}\n\n#Shorts`,
        tags: [...(content.tags || []), 'shorts', 'motivasyon', 'turkce'],
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
  console.log(`✅ https://youtube.com/shorts/${videoId}`);

  try {
    await youtube.thumbnails.set({
      videoId,
      media: { body: fs.createReadStream(thumbnailPath) },
    });
    console.log('✅ Thumbnail yüklendi');
  } catch (e) {
    console.log('⚠️ Thumbnail:', e.message);
  }

  return videoId;
}

// ─── ANA ─────────────────────────────────────────────────
async function main() {
  console.log('🚀 YouTube Shorts motivasyon videosu üretiliyor...\n');
  const tempFiles = [];

  try {
    const content = await generateContent();

    const { audioPath, duration } = await generateVoice(content.script);
    tempFiles.push(audioPath);

    const srtPath = await generateSubtitles(content.script, duration, audioPath);
    tempFiles.push(srtPath);

    const videoPaths = await downloadPexelsVideos(content.pexels_query, 4);
    tempFiles.push(...videoPaths);

    const finalVideoPath = await createShortsVideo(videoPaths, audioPath, duration, srtPath);
    tempFiles.push(finalVideoPath);

    const thumbnailPath = await createThumbnail(
      content.thumbnail_title,
      content.thumbnail_subtitle,
      videoPaths[0]
    );
    tempFiles.push(thumbnailPath);

    const videoId = await uploadToYouTube(content, finalVideoPath, thumbnailPath);

    tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });

    console.log(`\n🎉 BAŞARILI!`);
    console.log(`🔗 https://youtube.com/shorts/${videoId}`);
    process.exit(0);

  } catch (error) {
    tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
    console.error('\n❌ HATA:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
