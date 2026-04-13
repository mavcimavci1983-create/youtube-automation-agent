# 🚀 Kurulum Rehberi

## 1. Google Cloud Console

1. https://console.cloud.google.com adresine git
2. Yeni proje oluştur: `motivation-videos`
3. APIs & Services → Enable APIs:
   - ✅ YouTube Data API v3
   - ✅ Generative Language API (Gemini)
4. Credentials → Create Credentials → OAuth 2.0 Client ID
   - Application type: **Web application**
   - Redirect URI: `http://localhost:3000/callback`
5. Client ID ve Secret'ı kaydet

## 2. Gemini API Key

1. https://aistudio.google.com/app/apikey
2. "Create API Key" → kopyala
3. GitHub Secrets'a ekle: `GEMINI_API_KEY`

## 3. YouTube Refresh Token Al

```bash
npm run setup
```

Tarayıcı açılır → Google hesabına giriş → Token otomatik kaydedilir.

## 4. GitHub Secrets Ekle

Repo → Settings → Secrets and variables → Actions → New secret:

| Secret Adı | Değer |
|---|---|
| `GEMINI_API_KEY` | Gemini API key |
| `YOUTUBE_CLIENT_ID` | OAuth Client ID |
| `YOUTUBE_CLIENT_SECRET` | OAuth Client Secret |
| `YOUTUBE_REFRESH_TOKEN` | Refresh token |
| `YOUTUBE_CHANNEL_ID` | YouTube kanal ID |

## 5. Test Et

GitHub → Actions → "Günlük Motivasyon Videosu" → Run workflow

## ✅ Hazır!

Her gün saat 09:00 Türkiye saatinde otomatik video yüklenir.
