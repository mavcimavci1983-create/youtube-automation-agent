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

function fixTurkish(text) {
  if (!text) return '';
  // ASCII'ye cevirmek yerine, bozuk encoding'i duzelt
  return text
    .replace(/Ã\u009e/g, 'Ş').replace(/Ã\u009f/g, 'ş')
    .replace(/Ä\u00b0/g, 'İ').replace(/Ä\u00b1/g, 'ı')
    .replace(/Ã\u009c/g, 'Ü').replace(/Ã\u00bc/g, 'ü')
    .replace(/Ã\u0096/g, 'Ö').replace(/Ã\u00b6/g, 'ö')
    .replace(/Ã\u0087/g, 'Ç').replace(/Ã\u00a7/g, 'ç')
    .replace(/Ä\u009e/g, 'Ğ').replace(/Ä\u009f/g, 'ğ');
}

function cleanJson(text) {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ');
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
        reject(new Error('HTTP ' + response.statusCode));
        return;
      }
      response.pipe(file);
      file.on('finish', function() { file.close(resolve); });
    }).on('error', function(err) {
      try { fs.unlinkSync(dest); } catch(e) {}
      reject(err);
    });
  });
}

function runCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, { maxBuffer: 1024 * 1024 * 50 }, function(error, stdout, stderr) {
      if (error) {
        reject(new Error(error.message + '\n' + stderr));
      } else {
        resolve(stdout);
      }
    });
  });
}

function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

function formatSrtTime(seconds) {
  var h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  var m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  var s = Math.floor(seconds % 60).toString().padStart(2, '0');
  var ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
  return h + ':' + m + ':' + s + ',' + ms;
}

async function generateStoryContent() {
  console.log('Hikaye icerigi uretiliyor...');
  var groq = new Groq({ apiKey: GROQ_API_KEY });

  var day = new Date().getDay();
  var storyTypes = [
  {
    type: 'tarihi',
    pexels: 'inventor laboratory experiment discovery',
  },
  {
    type: 'bilge_genc',
    pexels: 'elderly man young person talking outdoor',
  },
  {
    type: 'baba_ogul',
    pexels: 'father teaching son life lesson walk',
  },
  {
    type: 'is_insani',
    pexels: 'mentor young entrepreneur office meeting',
  },
  {
    type: 'tarihi',
    pexels: 'soldier warrior strength courage battle',
  },
  {
    type: 'bilge_genc',
    pexels: 'wise old man nature meditation peaceful',
  },
  {
    type: 'baba_ogul',
    pexels: 'parent child bonding love family outdoor',
  },
];

  var story = storyTypes[day % storyTypes.length];
  console.log('Hikaye tipi:', story.type);

  var storyPrompts = {
    tarihi: 'Edison, Einstein, Ataturk, Walt Disney veya Steve Jobs hakkinda gercek bir anekdot yaz.',
    bilge_genc: 'Yasli bilge bir dede ile genc bir adam arasinda gecen hikaye yaz.',
    baba_ogul: 'Bir baba ile oglu arasinda gecen derin bir an anlat.',
    is_insani: 'Basarili bir is insani ile genc ciragi arasinda gecen sahne yaz.',
  };

  // ADIM 1: Önce sadece script üret
  var scriptCompletion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: 'Sen Turkce motivasyon hikayeleri yaziyorsun. Sadece hikaye metnini yaz, baska hicbir sey yazma.',
      },
      {
        role: 'user',
        content: storyPrompts[story.type] + '\n\n' +
          'KURALLAR:\n' +
          '- Tam olarak 130-150 kelime yaz\n' +
          '- Gercekten yasanmis gibi hissettir\n' +
          '- Muhakkak diyalog kullan (en az 3 satir konusma)\n' +
          '- Son 2 cumlede izleyiciye don, Sen de... diye basla\n' +
          '- Kisa ve vurucu cumleler kullan\n\n' +
          'Sadece hikaye metnini yaz, baslik veya aciklama ekleme.',
      },
    ],
    temperature: 0.92,
    max_tokens: 1000,
  });

  var script = scriptCompletion.choices[0].message.content.trim();
  script = fixTurkish(script);
  var wordCount = script.split(/\s+/).length;
  console.log('Script kelime sayisi:', wordCount);

  if (wordCount < 80) throw new Error('Script cok kisa: ' + wordCount);

  // ADIM 2: Metadata üret
  var metaCompletion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: 'YouTube metadata uretiyorsun. SADECE JSON dondur. Markdown kullanma.',
      },
      {
        role: 'user',
        content: 'Bu hikaye icin YouTube metadata uret:\n\n' + script + '\n\n' +
          'SADECE su JSON formatinda dondur (script alani olmayacak):\n' +
          '{"title":"45-55 karakter etkileyici baslik #Shorts","description":"250 karakter aciklama yorum yapmaya tesvik et","tags":["shorts","hikaye","motivasyon","turkce","ilham"],"hashtags":"#Shorts #hikaye #motivasyon #turkce #ilham","thumbnail_title":"IKI KELIME","thumbnail_subtitle":"vurucu kisa cumle"}',
      },
    ],
    temperature: 0.7,
    max_tokens: 500,
  });

  var metaRaw = metaCompletion.choices[0].message.content.trim();
  var metaCleaned = cleanJson(metaRaw);
  var jsonMatch = metaCleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Meta JSON bulunamadi');

  var meta = JSON.parse(jsonMatch[0]);

  // Birleştir
  var content = {
    title: fixTurkish(meta.title || 'Ilham Veren Hikaye #Shorts'),
    description: fixTurkish(meta.description || 'Gunluk motivasyon hikayesi'),
    tags: meta.tags || ['shorts', 'hikaye', 'motivasyon'],
    hashtags: meta.hashtags || '#Shorts #hikaye #motivasyon',
    thumbnail_title: fixTurkish(meta.thumbnail_title || 'HIKAYE'),
    thumbnail_subtitle: fixTurkish(meta.thumbnail_subtitle || 'ilham al'),
    pexels_query: story.pexels,
    script: script,
  };

  console.log('Hikaye hazir:', content.title, '(' + wordCount + ' kelime)');
  return content;
}
async function generateVoice(script) {
  console.log('Ses uretiliyor (AhmetNeural)...');
  var scriptPath = '/tmp/script.txt';
  var audioPath = '/tmp/voice.mp3';
  var vttPath = '/tmp/subtitles.vtt';

 fs.writeFileSync(scriptPath, '\uFEFF' + script, 'utf8');

  await runCommand(
    'edge-tts --voice tr-TR-AhmetNeural --file "' + scriptPath + '" ' +
    '--write-media "' + audioPath + '" --write-subtitles "' + vttPath + '" ' +
    '--rate="+8%"'
  );

  var duration = await new Promise(function(resolve, reject) {
    ffmpeg.ffprobe(audioPath, function(err, meta) {
      if (err) reject(err);
      else resolve(meta.format.duration);
    });
  });

  console.log('Ses suresi:', duration.toFixed(1) + 's');
  return { audioPath: audioPath, vttPath: vttPath, duration: duration };
}

function buildSrt(vttPath, srtPath) {
  var vtt = fs.readFileSync(vttPath, 'utf8');
  var lines = vtt.split('\n');
  var srt = '';
  var counter = 1;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line.indexOf('-->') !== -1) {
      var timeLine = line.replace(/\./g, ',');
      var text = lines[i + 1] ? fixTurkish(lines[i + 1].trim()) : '';
      if (text && text.indexOf('WEBVTT') === -1 && text.length > 0) {
        srt += counter + '\n' + timeLine + '\n' + text + '\n\n';
        counter++;
      }
    }
  }

  fs.writeFileSync(srtPath, srt, 'utf8');
  console.log('Altyazi satir sayisi:', counter - 1);
  return srtPath;
}

async function downloadPexelsVideos(query, count) {
  console.log('Pexels videoları indiriliyor:', query);
  count = count || 4;

  var response = await fetch(
    'https://api.pexels.com/videos/search?query=' + encodeURIComponent(query) + '&per_page=15&orientation=portrait',
    { headers: { Authorization: PEXELS_API_KEY } }
  );

  var data = await response.json();
  var videos = (data.videos || []);

  if (videos.length < 2) {
    var r2 = await fetch(
      'https://api.pexels.com/videos/search?query=' + encodeURIComponent(query) + '&per_page=15',
      { headers: { Authorization: PEXELS_API_KEY } }
    );
    var d2 = await r2.json();
    videos = d2.videos || [];
  }

  if (videos.length === 0) throw new Error('Video bulunamadi: ' + query);

  var paths = [];
  var limit = Math.min(count, videos.length);

  for (var i = 0; i < limit; i++) {
    var video = videos[i];
    var files = video.video_files.filter(function(f) { return f.width && f.height; });
    files.sort(function(a, b) { return b.height - a.height; });
    var vf = files[0];
    if (!vf) continue;

    var vPath = '/tmp/pexels_' + i + '.mp4';
    console.log('  Video', i + 1, '/', limit);
    await downloadFile(vf.link, vPath);
    paths.push(vPath);
    await sleep(300);
  }

  console.log(paths.length, 'video indirildi');
  return paths;
}

async function createThumbnail(title, subtitle, videoPath) {
  console.log('Thumbnail olusturuluyor...');

  await new Promise(function(resolve, reject) {
    ffmpeg(videoPath)
      .outputOptions(['-vframes 1', '-vf scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920'])
      .output('/tmp/thumb_raw.jpg')
      .on('end', resolve)
      .on('error', reject)
      .run();
  });

  var safeTitle = title.replace(/['"\\:]/g, '').trim();
  var safeSub = subtitle.replace(/['"\\:]/g, '').trim();

  await runCommand(
    'ffmpeg -y -i /tmp/thumb_raw.jpg ' +
    '-vf "colorchannelmixer=rr=0.3:gg=0.3:bb=0.4,' +
    'drawtext=text=\'' + safeTitle + '\':fontsize=90:fontcolor=white:x=(w-text_w)/2:y=(h/2)-120:shadowcolor=black:shadowx=4:shadowy=4,' +
    'drawtext=text=\'' + safeSub + '\':fontsize=46:fontcolor=yellow:x=(w-text_w)/2:y=(h/2)+60:shadowcolor=black:shadowx=2:shadowy=2" ' +
    '/tmp/thumbnail.jpg'
  );

  console.log('Thumbnail hazir');
  return '/tmp/thumbnail.jpg';
}

async function createShortsVideo(videoPaths, audioPath, duration, srtPath) {
  console.log('Video montaji yapiliyor...');

  var clipDuration = (duration / videoPaths.length) + 0.5;
  var trimmed = [];

  for (var i = 0; i < videoPaths.length; i++) {
    var tp = '/tmp/trimmed_' + i + '.mp4';
    await new Promise(function(resolve, reject) {
      ffmpeg(videoPaths[i])
        .outputOptions([
          '-t ' + clipDuration,
          '-vf scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1',
          '-r 30', '-c:v libx264', '-preset fast', '-crf 22', '-an',
        ])
        .output(tp)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
    trimmed.push(tp);
    console.log('  Klip', i + 1, '/', videoPaths.length);
  }

  var listPath = '/tmp/clips_list.txt';
  fs.writeFileSync(listPath, trimmed.map(function(p) { return "file '" + p + "'"; }).join('\n'));

  var mergedPath = '/tmp/merged.mp4';
  await new Promise(function(resolve, reject) {
    ffmpeg()
      .input(listPath)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c copy'])
      .output(mergedPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });

  var finalPath = '/tmp/final_video.mp4';
  await new Promise(function(resolve, reject) {
    ffmpeg()
      .input(mergedPath)
      .input(audioPath)
      .outputOptions([
        '-map 0:v:0', '-map 1:a:0',
        '-c:v libx264', '-preset fast', '-crf 22',
        '-c:a aac', '-b:a 128k',
        '-shortest', '-movflags +faststart',
      ])
      .videoFilter("subtitles=" + srtPath + ":force_style='FontSize=14,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,Shadow=1,Alignment=2,MarginV=40'")
      .output(finalPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });

  var stats = fs.statSync(finalPath);
  console.log('Video hazir:', (stats.size / 1024 / 1024).toFixed(1), 'MB');
  return finalPath;
}

async function uploadToYouTube(content, videoPath, thumbnailPath) {
  console.log('YouTube a yukleniyor...');

  var oauth2Client = new google.auth.OAuth2(
    YOUTUBE_CLIENT_ID,
    YOUTUBE_CLIENT_SECRET,
    'http://localhost:3000/callback'
  );
  oauth2Client.setCredentials({ refresh_token: YOUTUBE_REFRESH_TOKEN });

  var youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  var videoResponse = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: content.title,
        description: content.description + '\n\n' + content.hashtags + '\n\n#Shorts',
        tags: content.tags || ['shorts', 'hikaye', 'motivasyon'],
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

  var videoId = videoResponse.data.id;
  console.log('Video yuklendi: https://youtube.com/shorts/' + videoId);

  try {
    await youtube.thumbnails.set({
      videoId: videoId,
      media: { body: fs.createReadStream(thumbnailPath) },
    });
    console.log('Thumbnail yuklendi');
  } catch(e) {
    console.log('Thumbnail hatasi:', e.message);
  }

  return videoId;
}

async function main() {
  console.log('Hikaye Shorts videosu uretiliyor...\n');
  var tempFiles = [];

  try {
    var content = await generateStoryContent();

    var voice = await generateVoice(content.script);
    tempFiles.push(voice.audioPath, voice.vttPath);

    var srtPath = '/tmp/subtitles.srt';
    buildSrt(voice.vttPath, srtPath);
    tempFiles.push(srtPath);

    var videoPaths = await downloadPexelsVideos(content.pexels_query, 4);
    tempFiles = tempFiles.concat(videoPaths);

    var finalVideo = await createShortsVideo(videoPaths, voice.audioPath, voice.duration, srtPath);
    tempFiles.push(finalVideo);

    var thumbnail = await createThumbnail(content.thumbnail_title, content.thumbnail_subtitle, videoPaths[0]);
    tempFiles.push(thumbnail);

    var videoId = await uploadToYouTube(content, finalVideo, thumbnail);

    tempFiles.forEach(function(f) { try { fs.unlinkSync(f); } catch(e) {} });

    console.log('\nBASARILI! https://youtube.com/shorts/' + videoId);
    process.exit(0);

  } catch(error) {
    tempFiles.forEach(function(f) { try { fs.unlinkSync(f); } catch(e) {} });
    console.error('\nHATA:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
