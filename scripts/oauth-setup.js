const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const open = require('open');
require('dotenv').config();

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3000/callback';

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
];

async function getRefreshToken() {
  console.log('\n🚀 YouTube OAuth2 Kurulum Başlıyor...\n');

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('❌ YOUTUBE_CLIENT_ID veya YOUTUBE_CLIENT_SECRET eksik!');
    console.error('   Önce .env dosyasını oluştur (.env.example\'a bak)\n');
    process.exit(1);
  }

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Her seferinde refresh_token gelsin
  });

  console.log('🌐 Tarayıcı açılıyor...');
  console.log('   Eğer açılmazsa bu URL\'yi kopyala:\n');
  console.log(`   ${authUrl}\n`);

  // Tarayıcıyı aç
  try {
    await open(authUrl);
  } catch (e) {
    console.log('⚠️  Tarayıcı otomatik açılamadı, URL\'yi manuel kopyala.\n');
  }

  // Local server başlat — callback'i yakala
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url, true);

      if (parsedUrl.pathname !== '/callback') {
        res.end('404');
        return;
      }

      const code = parsedUrl.query.code;
      const error = parsedUrl.query.error;

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <html><body style="font-family:sans-serif;text-align:center;padding:50px">
            <h2>❌ Hata: ${error}</h2>
            <p>Terminale dön ve tekrar dene.</p>
          </body></html>
        `);
        server.close();
        reject(new Error(`OAuth hatası: ${error}`));
        return;
      }

      // Kodu token'a çevir
      try {
        const { tokens } = await oauth2Client.getToken(code);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <html><body style="font-family:sans-serif;text-align:center;padding:50px;background:#0a0a0a;color:#fff">
            <h2>✅ Başarılı!</h2>
            <p>Refresh token alındı. Terminale dön.</p>
            <p style="color:#888;font-size:14px">Bu sekmeyi kapatabilirsin.</p>
          </body></html>
        `);

        server.close();
        resolve(tokens);
      } catch (err) {
        res.end('Token alınamadı.');
        server.close();
        reject(err);
      }
    });

    server.listen(3000, () => {
      console.log('⏳ Yetkilendirme bekleniyor (localhost:3000)...\n');
    });

    // 5 dakika timeout
    setTimeout(() => {
      server.close();
      reject(new Error('⏰ Timeout: 5 dakika içinde yetkilendirme yapılmadı.'));
    }, 5 * 60 * 1000);
  });
}

async function main() {
  try {
    const tokens = await getRefreshToken();

    console.log('\n✅ TOKEN ALINDI!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 GitHub Secrets\'a şunları ekle:\n');
    console.log(`YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (!tokens.refresh_token) {
      console.warn('⚠️  refresh_token boş geldi!');
      console.warn('   Çözüm: Google hesabında bu uygulamanın iznini kaldır,');
      console.warn('   sonra tekrar çalıştır. (prompt: consent zorluyor)\n');
    } else {
      console.log('🎉 Artık GitHub Secrets\'a ekleyip Actions\'ı çalıştırabilirsin!\n');
    }

  } catch (err) {
    console.error('\n❌ Hata:', err.message);
    process.exit(1);
  }
}

main();
