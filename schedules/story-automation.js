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
  return text
    .replace(/\u015e/g, 'S').replace(/\u015f/g, 's')
    .replace(/\u0130/g, 'I').replace(/\u0131/g, 'i')
    .replace(/\u00dc/g, 'U').replace(/\u00fc/g, 'u')
    .replace(/\u00d6/g, 'O').replace(/\u00f6/g, 'o')
    .replace(/\u00c7/g, 'C').replace(/\u00e7/g, 'c')
    .replace(/\u011e/g, 'G').replace(/\u011f/g, 'g');
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
    { type: 'tarihi', pexels: 'historical achievement success' },
    { type: 'bilge_genc', pexels: 'old man mountain wisdom' },
    { type: 'baba_ogul', pexels: 'father son walking sunset' },
    { type: 'is_insani', pexels: 'business mentor office success' },
    { type: 'tarihi', pexels: 'determination perseverance nature' },
    { type: 'bilge_genc', pexels: 'mountain peak clouds sunrise' },
    { type: 'baba_ogul', pexels: 'family nature walk forest' },
  ];

  var story = storyTypes[day % storyTypes.length];
  console.log('Hikaye tipi:', story.type);

  var prompts = {
    tarihi: 'Edison, Einstein, Ataturk veya baska buyuk bir tarihi figur hakkinda gercek bir anekdot yaz.',
    bilge_genc: 'Yasli bilge bir dede ile genc bir adam arasinda gecen kisa bir hikaye yaz. Diyalog icersin.',
    baba_ogul: 'Bir baba ile oglu arasinda gecen kisa ama derin bir an anlat. Diyalog icersin.',
    is_insani: 'Basarili bir is insani ile genc ciragi arasinda gecen bir sahne yaz. Diyalog icersin.',
  };

  var storyPrompt = prompts[story.type] || prompts.bilge_genc;

  var systemMsg = 'Sen Turkce motivasyon hikayeleri yaziyorsun. SADECE JSON dondur. Markdown kullanma.';
  var userMsg = storyPrompt + '\n\n' +
    'Kurallari kesinlikle uy:\n' +
    '- Script tam olarak 120-150 kelime olmali\n' +
    '- Gercekten yasanmis gibi hissettir\n' +
    '- Diyalog kullan\n' +
    '- Sona izleyiciye don\n\n' +
    'Su JSON formatinda dondur:\n' +
    '{"title":"45-55 karakter baslik #Shorts","description":"250 karakter aciklama","tags":["shorts","hikaye","motivasyon"],"pexels_query":"' + story.pexels + '","script":"TAM HIKAYE 120-150 KELIME","hashtags":"#Shorts #hikaye #motivasyon","thumbnail_title":"IKI KELIME","thumbnail_subtitle":"kisa cumle"}';

  var completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemMsg },
      { role: 'user', content: userMsg },
    ],
    temperature: 0.9,
    max_tokens: 2000,
  });

  var raw = completion.choices[0].message.content.trim();
  var cleaned = cleanJson(raw);
  var jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON bulunamadi');

  var content = JSON.parse(jsonMatch[0]);
  var wordCount = content.script ? content.script.split(' ').length : 0;
  console.log('Script kelime sayisi:', wordCount);
  if (wordCount < 80) throw new Error('Script cok kisa: ' + wordCount);

  content.title = fixTurkish(content.title);
  content.description = fixTurkish(content.description);
  content.script = fixTurkish(content.script);
  content.thumbnail_title = fixTurkish(content.thumbnail_title || 'HIKAYE');
  content.thumbnail_subtitle = fixTurkish(content.thumbnail_subtitle || 'ilham ver');

  console.log('Hikaye hazir:', content.title);
  return content;
}

async function generateVoice(script) {
  console.log('Ses uretiliyor (AhmetNeural)...');
  var scriptPath = '/tmp/script.txt';
  var audioPath = '/tmp/voice.mp3';
  var vttPath = '/tmp/subtitles.vtt';

  fs.writeFileSync(scriptPath, script, 'utf8');

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
      .videoFilter("subtitles=" + srtPath + ":force_style='FontSize=18,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,Shadow=1,Alignment=2,MarginV=80'")
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
