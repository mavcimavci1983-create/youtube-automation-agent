require('dotenv').config();
var Groq = require('groq-sdk');
var { google } = require('googleapis');
var ffmpeg = require('fluent-ffmpeg');
var fs = require('fs');
var https = require('https');
var http = require('http');
var { exec } = require('child_process');

var GROQ_API_KEY = process.env.GROQ_API_KEY;
var PEXELS_API_KEY = process.env.PEXELS_API_KEY;
var YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
var YOUTUBE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
var YOUTUBE_REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN;

function fixTurkish(text) {
  if (!text) return '';
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
  return new Promise(function(resolve, reject) {
    var file = fs.createWriteStream(dest);
    var protocol = url.startsWith('https') ? https : http;
    protocol.get(url, function(response) {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        try { fs.unlinkSync(dest); } catch(e) {}
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
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
  return new Promise(function(resolve, reject) {
    exec(command, { maxBuffer: 1024 * 1024 * 50 }, function(error, stdout, stderr) {
      if (error) reject(new Error(error.message + '\n' + stderr));
      else resolve(stdout);
    });
  });
}

function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
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

// ─── HİKAYE TİPLERİ ──────────────────────────────────────
function getStoryType() {
  var day = new Date().getDay();

  var types = [
    {
      type: 'ataturk',
      figure: 'Mustafa Kemal Atatürk',
      era: 'Kurtuluş Savaşı ve Cumhuriyet dönemi Türkiye',
      pexels: [
        'turkish flag waving proud',
        'soldier military historical war',
        'ankara turkey historical',
        'battle war soldier courage',
        'leadership crowd speech historical',
      ],
    },
    {
      type: 'edison',
      figure: 'Thomas Edison',
      era: '1800ler sonu Amerika laboratuvar ortamı',
      pexels: [
        'light bulb invention electricity',
        'laboratory scientist experiment',
        'inventor working workshop',
        'electricity discovery historical',
        'scientist thinking problem solving',
      ],
    },
    {
      type: 'einstein',
      figure: 'Albert Einstein',
      era: '1900ler başı Avrupa üniversite ortamı',
      pexels: [
        'physics science blackboard equations',
        'scientist thinking genius',
        'university library books studying',
        'theory of relativity science',
        'genius scientist working',
      ],
    },
    {
      type: 'mevlana',
      figure: 'Mevlana Celaleddin Rumi',
      era: '13. yüzyıl Konya ve Anadolu',
      pexels: [
        'whirling dervish spiritual dance',
        'mosque islamic architecture konya',
        'sufi spiritual meditation',
        'ancient islamic art calligraphy',
        'spiritual wisdom meditation peaceful',
      ],
    },
    {
      type: 'disney',
      figure: 'Walt Disney',
      era: '1920ler-1930lar Hollywood animasyon stüdyosu',
      pexels: [
        'animation drawing cartoon studio',
        'creative artist drawing sketching',
        'dream imagination creativity',
        'filmmaker director studio',
        'success story perseverance',
      ],
    },
    {
      type: 'lincoln',
      figure: 'Abraham Lincoln',
      era: '1860lar Amerika iç savaş dönemi',
      pexels: [
        'american flag historical',
        'leadership speech crowd',
        'justice equality freedom',
        'historical america civil war',
        'president leadership courage',
      ],
    },
    {
      type: 'custom',
      figure: null,
      era: null,
      pexels: [
        'wise old man talking young person',
        'father son emotional conversation',
        'mentor student learning wisdom',
        'life lesson wisdom nature',
        'old man mountain peaceful wisdom',
      ],
    },
  ];

  return types[day % types.length];
}

// ─── HİKAYE İÇERİĞİ ──────────────────────────────────────
async function generateStoryContent() {
  console.log('Hikaye icerigi uretiliyor...');
  var groq = new Groq({ apiKey: GROQ_API_KEY });
  var storyType = getStoryType();
  console.log('Hikaye tipi:', storyType.type);

  var systemPrompt = 'Sen Türkiye\'nin en iyi motivasyon hikayecisisin. ' +
    'Türkçe karakterleri MUTLAKA kullan: ş, ğ, ü, ö, ç, ı, İ, Ş, Ğ. ' +
    'SADECE hikaye metnini yaz, başka hiçbir şey ekleme.';

  var userPrompt;

  if (storyType.figure) {
    userPrompt = storyType.figure + ' hakkında gerçek hayatından ilham alan, ' +
      storyType.era + ' dönemini yansıtan güçlü bir motivasyon hikayesi yaz.\n\n' +
      'ZORUNLU KURALLAR:\n' +
      '- 130-145 kelime\n' +
      '- Gerçek bir anı veya kriz anı anlat\n' +
      '- Mutlaka diyalog ekle (en az 2-3 satır)\n' +
      '- Somut detaylar: yıl, yer, kişi adı\n' +
      '- Son 3 cümle izleyiciye dönsün: "Sen de..." ile başla\n' +
      '- Duygusal ama abartısız\n' +
      '- Tarihi gerçeklere sadık kal\n\n' +
      'SADECE hikaye metnini yaz:';
  } else {
    var storyPrompts = [
      'Yaşlı bilge bir dede ile hayal kırıklığına uğramış genç bir adam arasında dağ başında geçen hikaye.',
      'Bir baba ölüm döşeğinde oğluna hayatın sırrını söylüyor.',
      'Başarılı bir iş insanı en karanlık dönemini genç çırağına anlatıyor.',
    ];
    userPrompt = storyPrompts[new Date().getDate() % storyPrompts.length] + '\n\n' +
      'ZORUNLU KURALLAR:\n' +
      '- 130-145 kelime\n' +
      '- Diyalog ekle (en az 3 satır)\n' +
      '- Somut detaylar ver\n' +
      '- Son 3 cümle izleyiciye dönsün\n\n' +
      'SADECE hikaye metnini yaz:';
  }

  // Script üret
  var scriptCompletion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.92,
    max_tokens: 1000,
  });

  var script = scriptCompletion.choices[0].message.content.trim();
  script = fixTurkish(script);
  var wordCount = script.split(/\s+/).length;
  console.log('Script kelime sayisi:', wordCount);

  // Kısaysa genişlet
  if (wordCount < 80) {
    console.log('Script kisa, genisletiliyor...');
    var retry = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: 'Bu hikayeyi 130-145 kelimeye genişlet, diyalog ve detay ekle:\n\n' +
            script + '\n\nGenişletilmiş halini yaz:'
        },
      ],
      temperature: 0.9,
      max_tokens: 1500,
    });
    script = fixTurkish(retry.choices[0].message.content.trim());
    wordCount = script.split(/\s+/).length;
    console.log('Yeniden uretilen script:', wordCount, 'kelime');
  }

  // Metadata üret
  var metaCompletion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: 'YouTube metadata uretiyorsun. SADECE JSON dondur. Markdown kullanma.' },
      {
        role: 'user',
        content: 'Bu hikaye icin metadata uret:\n\n' + script.substring(0, 300) + '\n\n' +
          'SADECE JSON:\n' +
          '{"title":"45-55 karakter #Shorts","description":"250 karakter","tags":["shorts","hikaye","motivasyon","turkce"],' +
          '"hashtags":"#Shorts #hikaye #motivasyon #turkce","thumbnail_title":"IKI KELIME","thumbnail_subtitle":"vurucu cumle"}',
      },
    ],
    temperature: 0.7,
    max_tokens: 500,
  });

  var metaRaw = cleanJson(metaCompletion.choices[0].message.content.trim());
  var jsonMatch = metaRaw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Meta JSON bulunamadi');
  var meta = JSON.parse(jsonMatch[0]);

  return {
    title: fixTurkish(meta.title || 'Ilham Veren Hikaye #Shorts'),
    description: fixTurkish(meta.description || 'Gunluk motivasyon hikayesi'),
    tags: meta.tags || ['shorts', 'hikaye', 'motivasyon'],
    hashtags: meta.hashtags || '#Shorts #hikaye #motivasyon',
    thumbnail_title: fixTurkish(meta.thumbnail_title || 'HIKAYE'),
    thumbnail_subtitle: fixTurkish(meta.thumbnail_subtitle || 'ilham al'),
    pexels_queries: storyType.pexels,
    script: script,
    figure: storyType.figure,
  };
}

// ─── SES ─────────────────────────────────────────────────
async function generateVoice(script) {
  console.log('Ses uretiliyor (AhmetNeural)...');
  var scriptPath = '/tmp/script.txt';
  var audioPath = '/tmp/voice.mp3';
  var vttPath = '/tmp/subtitles.vtt';
  fs.writeFileSync(scriptPath, '\uFEFF' + script, 'utf8');
  await runCommand(
    'edge-tts --voice tr-TR-AhmetNeural --file "' + scriptPath + '" ' +
    '--write-media "' + audioPath + '" --write-subtitles "' + vttPath + '" --rate="+8%"'
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

// ─── PEXELS VİDEO ─────────────────────────────────────────
async function downloadPexelsVideos(queries) {
  console.log('Pexels videolari indiriliyor...');
  var paths = [];
  var usedIds = [];

  for (var i = 0; i < queries.length; i++) {
    if (paths.length >= 4) break;
    try {
      var response = await fetch(
        'https://api.pexels.com/videos/search?query=' +
        encodeURIComponent(queries[i]) + '&per_page=10&orientation=portrait',
        { headers: { Authorization: PEXELS_API_KEY } }
      );
      var data = await response.json();
      var videos = data.videos || [];

      if (videos.length === 0) {
        response = await fetch(
          'https://api.pexels.com/videos/search?query=' +
          encodeURIComponent(queries[i]) + '&per_page=10',
          { headers: { Authorization: PEXELS_API_KEY } }
        );
        data = await response.json();
        videos = data.videos || [];
      }

      for (var j = 0; j < videos.length; j++) {
        if (paths.length >= 4) break;
        if (usedIds.indexOf(videos[j].id) !== -1) continue;
        var vf = videos[j].video_files
          .filter(function(f) { return f.width && f.height; })
          .sort(function(a, b) { return b.height - a.height; })[0];
        if (!vf) continue;
        usedIds.push(videos[j].id);
        var vPath = '/tmp/pexels_' + paths.length + '.mp4';
        console.log('  Sorgu:', queries[i], '| ID:', videos[j].id);
        await downloadFile(vf.link, vPath);
        paths.push(vPath);
        await sleep(300);
      }
    } catch(e) {
      console.log('  Hata:', queries[i], e.message);
    }
  }

  if (paths.length === 0) throw new Error('Hic video indirilemedi');
  console.log(paths.length, 'video indirildi');
  return paths;
}

// ─── THUMBNAIL ────────────────────────────────────────────
async function createThumbnail(title, subtitle, videoPath) {
  console.log('Thumbnail olusturuluyor...');
  await new Promise(function(resolve, reject) {
    ffmpeg(videoPath)
      .outputOptions(['-vframes 1',
        '-vf scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920'])
      .output('/tmp/thumb_raw.jpg')
      .on('end', resolve).on('error', reject).run();
  });

  var safeTitle = title.replace(/['"\\]/g, '').trim();
  var safeSub = subtitle.replace(/['"\\]/g, '').trim();

  await runCommand(
    'ffmpeg -y -i /tmp/thumb_raw.jpg ' +
    '-vf "colorchannelmixer=rr=0.3:gg=0.3:bb=0.4,' +
    'drawtext=text=\'' + safeTitle + '\':fontsize=95:fontcolor=white:x=(w-text_w)/2:y=(h/2)-130:shadowcolor=black:shadowx=4:shadowy=4,' +
    'drawtext=text=\'' + safeSub + '\':fontsize=48:fontcolor=yellow:x=(w-text_w)/2:y=(h/2)+60:shadowcolor=black:shadowx=2:shadowy=2" ' +
    '/tmp/thumbnail.jpg'
  );
  return '/tmp/thumbnail.jpg';
}

// ─── VİDEO MONTAJI ───────────────────────────────────────
async function createShortsVideo(videoPaths, audioPath, duration, srtPath) {
  console.log('Shorts montaji (1080x1920)...');
  var clipDuration = duration / videoPaths.length;
  var trimmed = [];

  for (var i = 0; i < videoPaths.length; i++) {
    var tp = '/tmp/trimmed_' + i + '.mp4';
    var clipD = clipDuration.toFixed(2);
    var inputPath = videoPaths[i].path || videoPaths[i];
    await new Promise(function(resolve, reject) {
      ffmpeg(inputPath)
        .outputOptions([
          '-t ' + clipD,
          '-vf scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1',
          '-r 30', '-c:v libx264', '-preset fast', '-crf 22', '-an',
        ])
        .output(tp).on('end', resolve).on('error', reject).run();
    });
    trimmed.push(tp);
    console.log('  Klip', i + 1, '/', videoPaths.length, 'hazir');
  }

  var listPath = '/tmp/clips_list.txt';
  fs.writeFileSync(listPath, trimmed.map(function(p) { return "file '" + p + "'"; }).join('\n'));

  var mergedPath = '/tmp/merged.mp4';
  await new Promise(function(resolve, reject) {
    ffmpeg().input(listPath).inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c copy']).output(mergedPath)
      .on('end', resolve).on('error', reject).run();
  });

  var finalPath = '/tmp/final_video.mp4';
  await new Promise(function(resolve, reject) {
    ffmpeg().input(mergedPath).input(audioPath)
      .outputOptions([
        '-map 0:v:0', '-map 1:a:0',
        '-c:v libx264', '-preset fast', '-crf 22',
        '-c:a aac', '-b:a 128k', '-shortest', '-movflags +faststart',
      ])
      .videoFilter("subtitles=" + srtPath + ":force_style='FontSize=14,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,Shadow=1,Alignment=2,MarginV=40'")
      .output(finalPath).on('end', resolve).on('error', reject).run();
  });

  var stats = fs.statSync(finalPath);
  console.log('Video hazir:', (stats.size / 1024 / 1024).toFixed(1), 'MB');
  return finalPath;
}

// ─── YOUTUBE UPLOAD ───────────────────────────────────────
async function uploadToYouTube(content, videoPath, thumbnailPath) {
  var oauth2Client = new google.auth.OAuth2(
    YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, 'http://localhost:3000/callback'
  );
  oauth2Client.setCredentials({ refresh_token: YOUTUBE_REFRESH_TOKEN });
  var youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  var res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: content.title,
        description: content.description + '\n\n' + content.hashtags + '\n\n#Shorts',
        tags: content.tags,
        categoryId: '26',
        defaultLanguage: 'tr',
        defaultAudioLanguage: 'tr',
      },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
    },
    media: { body: fs.createReadStream(videoPath) },
  });

  var videoId = res.data.id;
  console.log('Video yuklendi: https://youtube.com/shorts/' + videoId);
  try {
    await youtube.thumbnails.set({
      videoId: videoId,
      media: { body: fs.createReadStream(thumbnailPath) },
    });
  } catch(e) { console.log('Thumbnail hatasi:', e.message); }
  return videoId;
}

// ─── ANA ─────────────────────────────────────────────────
async function main() {
  console.log('Hikaye Shorts videosu uretiliyor...\n');
  var tempFiles = [];

  try {
    var content = await generateStoryContent();
    console.log('Hikaye:', content.title);
    console.log('Pexels sorgular:', content.pexels_queries.slice(0, 3).join(', '));

    var voice = await generateVoice(content.script);
    tempFiles.push(voice.audioPath, voice.vttPath);

    var srtPath = '/tmp/subtitles.srt';
    buildSrt(voice.vttPath, srtPath);
    tempFiles.push(srtPath);

    var videoPaths = await downloadPexelsVideos(content.pexels_queries);
    tempFiles = tempFiles.concat(videoPaths);

    var finalVideo = await createShortsVideo(videoPaths, voice.audioPath, voice.duration, srtPath);
    tempFiles.push(finalVideo);

    var thumbnail = await createThumbnail(
      content.thumbnail_title,
      content.thumbnail_subtitle,
      videoPaths[0]
    );
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
