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
  // Sadece bozuk encoding'i duzelt, dogru karakterlere dokunma
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
    tarihi: 'Edison, Einstein, Atatürk, Walt Disney, Elon Musk, Steve Jobs veya Nikola Tesla hakkında ' +
      'gerçek bir kriz anını anlat. O an nasıl bir seçim yaptı? Ne hissetti? ' +
      'Gerçek diyalog ekle, sanki oradaymış gibi yaz.',

    bilge_genc: 'Yaşlı bilge bir dede ile hayal kırıklığına uğramış genç bir adam arasında geçen sahneyi yaz. ' +
      'Genç bir şikayetle geliyor. Dede basit ama derin bir şeyle cevap veriyor. ' +
      'O cevap gencin dünyasını değiştiriyor. Somut bir metafor kullan.',

    baba_ogul: 'Bir baba ölüm döşeğinde oğluna son sözlerini söylüyor. ' +
      'Ya da bir baba oğlunun en büyük başarısızlık anında yanında. ' +
      'O an söylenen bir cümle oğlunun hayatını değiştiriyor. ' +
      'Duygu yoğun ama abartısız olsun.',

    is_insani: 'Dünyaca tanınan bir iş insanı genç bir girişimciye en karanlık dönemini anlatıyor. ' +
      'Şirket batmak üzereydi. O an ne yaptı? Hangi kararı verdi? ' +
      'Gerçek rakamlar ve somut detaylar ekle.',
  };

  // ADIM 1: Önce sadece script üret
  var scriptCompletion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: 'Sen Türkiyenin en iyi motivasyon hikayecisisin. ' +
          'Tony Robbins, Les Brown ve Şeb-i Arus tarzını birleştiren, ' +
          'insanı derinden sarsan, gözyaşı getiren hikayeler yazıyorsun. ' +
          'Türkçe karakterleri MUTLAKA kullan: ş, ğ, ü, ö, ç, ı, İ, Ş, Ğ, Ü, Ö, Ç. ' +
          'SADECE hikaye metnini yaz, başlık veya açıklama ekleme.',
      },
      {
        role: 'user',
        content: storyPrompts[story.type] + '\n\n' +
          'ZORUNLU KURALLAR:\n' +
          '- Tam olarak 130-145 kelime yaz\n' +
          '- İlk cümle ÇARPICI olsun — okuyucu duraksasın\n' +
          '- Mutlaka 3-4 satır diyalog olsun, gerçek konuşma gibi\n' +
          '- Somut detaylar ver: yıl, şehir, meslek, isim\n' +
          '- Duygusal zirve: karakterin içinde bir şey kırılsın veya aydınlansın\n' +
          '- Son 3 cümle izleyiciye dönsün: "Sen de..." veya "Bugün sen..."\n' +
          '- Her cümle maksimum 10 kelime\n' +
          '- Türkçe karakterleri doğru kullan: ş, ğ, ü, ö, ç, ı\n\n' +
          'GÜÇLÜ HİKAYE ÖRNEĞİ (bu seviyede yaz):\n' +
          '1971. NASA mühendisi John, 3 yıldır aynı hesabı yapıyordu.\n' +
          'Her seferinde 0.001 fark çıkıyordu.\n' +
          'Patronu dedi ki: Bırak artık, kimse fark etmez.\n' +
          'John bırakmadı.\n' +
          'O 0.001, Apollo 13 i kurtardı.\n' +
          'Ekip ona sordu: Neden vazgeçmedin?\n' +
          'John sadece şunu dedi: Çünkü birisi bir gün o rakama güvenecekti.\n' +
          'Bugün sen de küçük bir şeyi doğru yapmaktan yoruldun mu?\n' +
          'O küçük şey, bir gün birinin hayatını kurtarabilir.\n' +
          'Bırakma.',
      },
    ],
    temperature: 0.95,
    max_tokens: 1000,
  });

  var script = scriptCompletion.choices[0].message.content.trim();
  script = fixTurkish(script);
  var wordCount = script.split(/\s+/).length;
  console.log('Script kelime sayisi:', wordCount);

  if (wordCount < 80) {
    console.log('Script kisa geldi, tekrar uretiliyor...');
    var retry = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'Sen Türkçe motivasyon hikayecisisin. Türkçe karakterleri kullan: ş, ğ, ü, ö, ç, ı. SADECE hikaye yaz.',
        },
        {
          role: 'user',
          content: 'Asagidaki hikayeyi 130-145 kelimeye genislet. ' +
            'Diyalog ekle, somut detay ekle, izleyiciye donen kapanis ekle.\n\n' +
            'Mevcut hikaye:\n' + script + '\n\n' +
            'Genisletilmis halini yaz (SADECE hikaye metni):',
        },
      ],
      temperature: 0.9,
      max_tokens: 1500,
    });
    script = retry.choices[0].message.content.trim();
    script = fixTurkish(script);
    wordCount = script.split(/\s+/).length;
    console.log('Yeniden uretilen script:', wordCount, 'kelime');
  }

// ADIM 2: Metadata + görsel sorgular üret
  var metaCompletion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: 'YouTube metadata ve gorsel sorgulari uretiyorsun. SADECE JSON dondur.',
      },
      {
        role: 'user',
        content: 'Bu hikaye icin metadata ve gorsel sorgulari uret:\n\n' + script + '\n\n' +
          'SADECE su JSON formatinda dondur:\n' +
          '{\n' +
          '  "title": "45-55 karakter baslik #Shorts",\n' +
          '  "description": "250 karakter aciklama",\n' +
          '  "tags": ["shorts","hikaye","motivasyon","turkce","ilham"],\n' +
          '  "hashtags": "#Shorts #hikaye #motivasyon #turkce #ilham",\n' +
          '  "thumbnail_title": "IKI KELIME",\n' +
          '  "thumbnail_subtitle": "vurucu cumle",\n' +
          '  "pexels_queries": ["hikayeyle uyumlu sorgu 1","sorgu 2","sorgu 3","sorgu 4","sorgu 5"]\n' +
          '}\n\n' +
          'pexels_queries kurallari:\n' +
          '- Her sorgu Ingilizce olmali\n' +
          '- Hikayedeki sahne veya karakterle uyumlu olmali\n' +
          '- Tarihi bir figur varsa o figuru veya donemi ara (ornek: "Ataturk historical Turkey", "Edison laboratory invention")\n' +
          '- Duygu veya temaya gore sec (ornek: "father son emotional sunset", "old man mountain wisdom")\n' +
          '- 2-4 kelime olmali',
      },
    ],
    temperature: 0.7,
    max_tokens: 600,
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
    pexels_queries: meta.pexels_queries || [story.pexels],
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

async function downloadPexelsVideos(queries, count) {
  console.log('Pexels videoları indiriliyor...');
  count = count || 4;
  var paths = [];
  var usedIds = [];

  // queries string ise diziye çevir
  if (typeof queries === 'string') queries = [queries];

  for (var i = 0; i < queries.length; i++) {
    if (paths.length >= count) break;

    try {
      // Portrait dene
      var response = await fetch(
        'https://api.pexels.com/videos/search?query=' +
        encodeURIComponent(queries[i]) + '&per_page=10&orientation=portrait',
        { headers: { Authorization: PEXELS_API_KEY } }
      );
      var data = await response.json();
      var videos = data.videos || [];

      // Bulamazsa landscape
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
        if (paths.length >= count) break;
        if (usedIds.indexOf(videos[j].id) !== -1) continue;

        var vf = videos[j].video_files
          .filter(function(f) { return f.width && f.height; })
          .sort(function(a, b) { return b.height - a.height; })[0];

        if (!vf) continue;

        usedIds.push(videos[j].id);
        var vPath = '/tmp/pexels_' + paths.length + '.mp4';
        console.log('  Sorgu:', queries[i], '| ID:', videos[j].id);
        await downloadFile(vf.link, vPath);
        paths.push({ path: vPath, duration: videos[j].duration });
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

async function createThumbnail(title, subtitle, videoPath) {
  console.log('Thumbnail olusturuluyor...');

  // videoPath obje veya string olabilir
  var inputPath = videoPath.path || videoPath;

  await new Promise(function(resolve, reject) {
    ffmpeg(inputPath)
      .outputOptions([
        '-vframes 1',
        '-vf scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
      ])
      .output('/tmp/thumb_raw.jpg')
      .on('end', resolve)
      .on('error', reject)
      .run();
  });

  var safeTitle = title.replace(/['"\\]/g, '').trim();
  var safeSub = subtitle.replace(/['"\\]/g, '').trim();

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
          '-r 30',
          '-c:v libx264',
          '-preset fast',
          '-crf 22',
          '-an',
        ])
        .output(tp)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
    trimmed.push(tp);
    console.log('  Klip', i + 1, '/', videoPaths.length, 'hazir');
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

    // 3. Pexels videoları — içerikle uyumlu sorgularla
    var videoPaths = await downloadPexelsVideos(content.pexels_queries, 4);
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
