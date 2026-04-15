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

// ─── 1. HİKAYE İÇERİĞİ ÜRET ─────────────────────────────
async function generateStoryContent() {
  console.log('🤖 Hikaye içeriği üretiliyor...');
  const groq = new Groq({ apiKey: GROQ_API_KEY });

  // Her gün farklı karakter tipi
  const day = new Date().getDay();
  const storyTypes = [
    {
      type: 'bilge_genc',
      setup: 'Yaşlı bir bilge ve genç bir adam arasında geçen',
      characters: 'Bilge Dede ve Genç Adam',
      setting: 'dağ başında, çay bahçesinde veya köy meydanında',
      pexels: 'old man mountain wisdom nature',
    },
    {
      type: 'baba_ogul',
      setup: 'Bir baba ve oğlu arasında yaşanmış gerçek gibi',
      characters: 'Baba ve Oğul',
      setting: 'sabah kahvaltısında, işe giderken veya akşam yürüyüşünde',
      pexels: 'father son walking sunset nature',
    },
    {
      type: 'is_insani_cirak',
      setup: 'Başarılı bir iş insanı ve genç çırağı arasında geçen',
      characters: 'Mentor ve Genç Girişimci',
      setting: 'ofiste, fabrikada veya kahvede',
      pexels: 'business mentor office success',
    },
    {
      type: 'tarihi',
      setup: 'Tarihi bir figürün gerçek hayatından ilham alan',
      characters: 'Atatürk, Edison, Einstein, Mevlana veya başka büyük bir isim',
      setting: 'tarihi bir anda, kritik bir kararın verildiği yerde',
      pexels: 'historical achievement success determination',
    },
  ];

  const story = storyTypes[day % storyTypes.length];
  console.log(`Hikaye tipi: ${story.type}`);

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: `Sen Türkiye'nin en iyi hikaye anlatıcısısın.
Kısa ama derin, gerçekmiş gibi hissettiren motivasyon hikayeleri yazıyorsun.
Her hikaye bir ders içeriyor, izleyiciyi derinden etkiliyor.
SADECE geçerli JSON döndür. Asla markdown veya açıklama ekleme.`,
      },
      {
        role: 'user',
        content: `${story.setup} bir hikaye yaz. Karakterler: ${story.characters}. Ortam: ${story.setting}.

ZORUNLU KURALLAR:
- Tam olarak 130-145 kelime (60 saniye için)
- Gerçekmiş gibi hissettir — tarih, yer, detay ver
- Diyalog kullan — karakterler konuşsun
- Tek güçlü bir ders ver
- Sona doğru izleyiciye dön ve o dersi ona uygula
- Duygusal ama abartısız ol

ÖRNEK YAPI:
"[Giriş — sahneyi kur, 2 cümle]
[Karakter 1 bir şey yapıyor/söylüyor]
[Karakter 2 şaşırıyor/soruyor]
[Karakter 1 ders veriyor — diyalog]
[Sessizlik — düşündürücü an]
[İzleyiciye dön — sen de...]"

ÖRNEK HİKAYE (bu kalitede yaz):
"1962 yılı. Edison'un laboratuvarı yanmıştı. Her şey kül olmuştu. Oğlu koşarak geldi: Baba, ne yapacağız? Edison güldü. Şansımız var oğlum, dedi. Tüm hatalarımız da yandı. Yarın temiz sayfa açıyoruz. İki yıl sonra Edison tarihin en büyük icatlarından birini yaptı. Sen de bugün bir şey kaybettin mi? O kayıp aslında yeniden başlama iznin. Kullan onu."

SADECE bu JSON formatında döndür:
{
  "title": "hikaye başlığı 45-55 karakter #Shorts",
  "description": "hikayenin özü 250-300 karakter, yorum yapmaya teşvik et",
  "tags": ["shorts", "hikaye", "motivasyon", "turkce", "ilham", "gercek", "basari"],
  "pexels_query": "${story.pexels}",
  "script": "TAM HİKAYE METNİ — 130-145 kelime",
  "hashtags": "#Shorts #hikaye #motivasyon #turkce #ilham #gercek",
  "thumbnail_title": "IKI KELIME",
  "thumbnail_subtitle": "hikayeden vurucu cumle"
}`,
      },
    ],
    temperature: 0.92,
    max_tokens: 2000,
  });

  const text = completion.choices[0].message.content.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON bulunamadı: ' + text.substring(0, 300));

  const content = JSON.parse(jsonMatch[0]);

  const wordCount = content.script.split(' ').length;
  console.log(`Script: ${wordCount} kelime`);
  if (wordCount < 100) throw new Error(`Script çok kısa: ${wordCount} kelime`);

  content.title = fixTurkish(content.title);
  content.description = fixTurkish(content.description);
  content.script = fixTurkish(content.script);
  content.thumbnail_title = fixTurkish(content.thumbnail_title);
  content.thumbnail_subtitle = fixTurkish(content.thumbnail_subtitle);

  console.log(`✅ Hikaye: "${content.title}" (${wordCount} kelime)`);
  return content;
}

// ─── 2. EDGE-TTS: SES ────────────────────────────────────
async function generateVoice(script) {
  console.log('🎙️ Edge-TTS (AhmetNeural) ile ses üretiliyor...');

  const scriptPath = '/tmp/script.txt';
  const audioPath = '/tmp/voice.mp3';
  const vttPath = '/tmp/subtitles.vtt';

  fs.writeFileSync(scriptPath, script, 'utf8');

  await runCommand(
    `edge-tts --voice tr-TR-AhmetNeural --file "${scriptPath}" ` +
    `--write-media "${audioPath}" --write-subtitles "${vttPath}" ` +
    `--rate="+8%" --pitch="+0Hz"`
  );

  const duration = await new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, meta) => {
      if (err) reject(err);
      else resolve(meta.format.duration);
    });
  });

  console.log(`✅ Ses: ${duration.toFixed(1)}s`);
  return { audioPath, vttPath, duration };
}

// ─── 3. ALTYAZI SRT ──────────────────────────────────────
function convertVttToSrt(vttPath, srtPath) {
  const vttContent = fs.readFileSync(vttPath, 'utf8');
  const lines = vttContent.split('\n');
  let srtContent = '';
  let counter = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.includes('-->')) {
      const timeLine = line
        .replace(/\./g, ',')
        .replace(/(\d{2},\d{3})\s/g, '$1 ');
      const text = lines[i + 1] ? fixTurkish(lines[i + 1].trim()) : '';
      if (text && !text.startsWith('WEBVTT')) {
        srtContent += `${counter}\n${timeLine}\n${text}\n\n`;
        counter++;
      }
    }
  }

  fs.writeFileSync(srtPath, srtContent, 'utf8');
  console.log(`✅ Altyazı: ${counter - 1} satır`);
  return srtPath;
}

// ─── 4. PEXELS VİDEO ─────────────────────────────────────
async function downloadPexelsVideos(query, count = 4) {
  console.log(`🎬 Pexels: "${query}"`);

  const response = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=15&orientation=portrait`,
    { headers: { Authorization: PEXELS_API_KEY } }
  );

  if (!response.ok) throw new Error(`Pexels: ${response.status}`);
  let data = await response.json();
  let videos = data.videos || [];

  if (videos.length < 2) {
    const r2 = await fetch(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=15`,
      { headers: { Authorization: PEXELS_API_KEY } }
    );
    const d2 = await r2.json();
    videos = d2.videos || [];
  }

  if (videos.length === 0) throw new Error('Video bulunamadı: ' + query);

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

  console.log(`✅ ${videoPaths.length} video`);
  return videoPaths;
}

// ─── 5. THUMBNAIL ────────────────────────────────────────
async function createThumbnail(title, subtitle, videoPath) {
  console.log('🖼️ Thumbnail oluşturuluyor...');

  await new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions(['-vframes 1', '-vf scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920'])
      .output('/tmp/thumb_raw.jpg')
      .on('end', resolve)
      .on('error', reject)
      .run();
  });

  const safeTitle = title.replace(/['"\\]/g, '').trim();
  const safeSubtitle = subtitle.replace(/['"\\]/g, '').trim();

  await runCommand(
    `ffmpeg -y -i /tmp/thumb_raw.jpg ` +
    `-vf "colorchannelmixer=rr=0.3:gg=0.3:bb=0.4,` +
    `drawtext=text='${safeTitle}':fontsize=95:fontcolor=white:x=(w-text_w)/2:y=(h/2)-130:shadowcolor=black:shadowx=4:shadowy=4,` +
    `drawtext=text='${safeSubtitle}':fontsize=46:fontcolor=yellow:x=(w-text_w)/2:y=(h/2)+50:shadowcolor=black:shadowx=2:shadowy=2,` +
    `drawtext=text='Hikaye':fontsize=40:fontcolor=white:x=(w-text_w)/2:y=h-110:shadowcolor=black:shadowx=2:shadowy=2" ` +
    `/tmp/thumbnail.jpg`
  );

  console.log('✅ Thumbnail hazır');
  return '/tmp/thumbnail.jpg';
}

// ─── 6. SHORTS MONTAJ ────────────────────────────────────
async function createShortsVideo(videoPaths, audioPath, duration, srtPath) {
  console.log('🎞️ Shorts montajı (1080x1920)...');

  const clipDuration = (duration / videoPaths.length) + 0.5;
  const trimmedPaths = [];

  for (let i = 0; i < videoPaths.length; i++) {
    const trimPath = `/tmp/trimmed_${i}.mp4`;
    await new Promise((resolve, reject) => {
      ffmpeg(videoPaths[i])
        .outputOptions([
          `-t ${clipDuration}`,
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
    console.log(`  Klip ${i + 1}/${videoPaths.length}`);
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
      .videoFilter(`subtitles=${srtPath}:force_style='FontSize=18,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,Shadow=1,Alignment=2,MarginV=80'`)
      .output(finalPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });

  const stats = fs.statSync(finalPath);
  console.log(`✅ Video: ${(stats.size / 1024 / 1024).toFixed(1)} MB, ${duration.toFixed(1)}s`);
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
  console.log('📖 Hikaye Shorts videosu üretiliyor...\n');
  const tempFiles = [];

  try {
    const content = await generateStoryContent();

    const { audioPath, vttPath, duration } = await generateVoice(content.script);
    tempFiles.push(audioPath, vttPath);

    const srtPath = '/tmp/subtitles.srt';
    convertVttToSrt(vttPath, srtPath);
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
